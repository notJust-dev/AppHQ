import { TRPCError, initTRPC } from '@trpc/server'
import type { AccountSession, AccountUser, Accounts } from '../auth/accounts.js'
import type { Db, Sql } from '../db/client.js'
import type { Secrets } from '../lib/crypto.js'
import type { Logger } from '../lib/logger.js'
import { scopeFor } from '../organizations/scope.js'
import type { SyncDeps } from '../sync/runner.js'

/**
 * Who may call a procedure. Set with `.meta({ access })`; a procedure without it is `dashboard`.
 *
 * - `public`: anyone the dashboard server forwards, such as the landing page's waitlist form.
 * - `account`: a signed-in account with a verified address. It sees only its own account.
 * - `dashboard`: everything else, in one organization. Either someone signed in with the
 *   dashboard password, when this API accepts it (`ALLOW_DASHBOARD_PASSWORD`), or an account
 *   with a verified address, approved access, and a membership of the organization it works in.
 *   `inOrganization` below says which organization.
 */
export type Access = 'public' | 'account' | 'dashboard'

export interface ApiMeta {
  access?: Access
}

/**
 * How the dashboard server says that the visitor signed in with the dashboard password. The API
 * can't check the password itself (it lives on the dashboard server), so it trusts the server
 * that holds the internal token, and only while `ALLOW_DASHBOARD_PASSWORD` is on. Must match
 * apps/web/src/server/api.ts.
 */
export const ACCESS_HEADER = 'x-apphq-access'
export const DASHBOARD_ACCESS = 'dashboard'

/**
 * Everything a request brings. A dashboard procedure gets a scope instead of `db` (see
 * `procedure`); the others have none, so they cannot reach any organization's data.
 */
export interface ApiContext {
  /** For the procedures that are not about an organization's data: the waitlist and accounts. */
  db: Db
  sql: Sql
  secrets: Secrets
  log: Logger
  /**
   * The request carries the dashboard server's statement that the visitor signed in with the
   * dashboard password, and this API accepts that statement (`ALLOW_DASHBOARD_PASSWORD`).
   */
  passwordAccess: boolean
  /** Null when accounts are not set up on this server. */
  accounts: Accounts | null
  /** The account session behind the request's cookie, looked up at most once per request. */
  session: () => Promise<AccountSession | null>
  /** The account behind the request's cookie: `session`'s user. */
  account: () => Promise<AccountUser | null>
  /** The organization a dashboard-password session works in; see organizations/dashboard.ts. */
  dashboardOrganization: () => Promise<string>
}

const t = initTRPC.context<ApiContext>().meta<ApiMeta>().create()

/**
 * Whether an account may use the dashboard at all: a verified address and approved access. It
 * still needs a membership to get an organization; see `organizationFor`.
 */
function mayUseDashboard(account: AccountUser | null | undefined): account is AccountUser {
  return account?.emailVerified === true && account.accessStatus === 'approved'
}

/** The one place access is decided. It runs before any input is read. */
const guard = t.middleware(async ({ ctx, meta, next }) => {
  const access: Access = meta?.access ?? 'dashboard'
  switch (access) {
    case 'public':
      return next()
    case 'account': {
      const account = await ctx.account()
      if (!account?.emailVerified) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Sign in first.' })
      return next()
    }
    case 'dashboard':
      if (ctx.passwordAccess || mayUseDashboard(await ctx.account())) return next()
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Sign in to the dashboard first.' })
    default:
      throw new TRPCError({ code: 'FORBIDDEN', message: 'This procedure has no access rule.' })
  }
})

/** How a dashboard request got in. */
export type DashboardVia = 'password' | 'account'

/**
 * The one place that decides which organization a dashboard request works in, or that it has
 * none and is refused:
 *
 * - The dashboard password (accepted by this API): the `default` organization, as always.
 * - An account with a verified address and approved access: one it is a member of. The session's
 *   active organization when the account still belongs to it; otherwise its oldest membership,
 *   which is then recorded on the session. Only this code sets the active organization: the
 *   plugin's own endpoints are not reachable (`AUTH_PATHS`). No membership: refused. Nothing here
 *   makes an organization.
 *
 * The dashboard server sends one or the other, never both; if both came, the password wins.
 */
async function organizationFor(ctx: ApiContext): Promise<{ organizationId: string; via: DashboardVia } | null> {
  if (ctx.passwordAccess) return { organizationId: await ctx.dashboardOrganization(), via: 'password' }

  const session = await ctx.session()
  if (!ctx.accounts || !session || !mayUseDashboard(session.user)) return null
  const memberships = await ctx.accounts.membershipsOf(session.user.id)
  const active = session.activeOrganizationId
  const organizationId = active && memberships.includes(active) ? active : memberships[0]
  if (!organizationId) return null
  if (organizationId !== active) await ctx.accounts.setActiveOrganization(session.sessionId, organizationId)
  return { organizationId, via: 'account' }
}

/**
 * The organization a dashboard procedure reads and writes in (see `organizationFor`), put in the
 * context after the guard has accepted the request.
 *
 * The context then is that organization's scope (`organizationId` and `run`), and `db` is gone:
 * every read and write goes through `run`, where row-level security holds it to the
 * organization. `background` is for work that carries on after the request (`startSync`), which
 * opens its own units of work.
 */
const inOrganization = t.middleware(async ({ ctx, meta, next }) => {
  // Public and account procedures are built from `openProcedure` and never get here.
  const found = (meta?.access ?? 'dashboard') === 'dashboard' ? await organizationFor(ctx) : null
  if (!found) throw new TRPCError({ code: 'FORBIDDEN', message: 'Sign in to the dashboard first.' })
  const { organizationId, via } = found
  const { run } = scopeFor(ctx.db, organizationId)
  const background: SyncDeps = { db: ctx.db, sql: ctx.sql, log: ctx.log, secrets: ctx.secrets }
  return next({ ctx: { organizationId, via, run, background, db: undefined } })
})

export const router = t.router

/**
 * Dashboard procedures. Every procedure passes the guard; these then get the organization they
 * work in as their context's scope, and every query and write goes through it.
 */
export const procedure = t.procedure.use(guard).use(inOrganization)

/**
 * For the `public` and `account` procedures only, which must say so in their `meta`. They have no
 * organization in their context, so they cannot reach any organization's data.
 */
export const openProcedure = t.procedure.use(guard)

/** The signed-in account in an `account` procedure; the guard has already checked it. */
export async function signedInAccount(ctx: ApiContext): Promise<AccountUser> {
  const account = await ctx.account()
  if (!account?.emailVerified || !ctx.accounts) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Sign in first.' })
  return account
}
