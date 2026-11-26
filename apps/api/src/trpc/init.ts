import { TRPCError, initTRPC } from '@trpc/server'
import type { AccountUser, Accounts } from '../auth/accounts.js'
import type { Db, Sql } from '../db/client.js'
import type { Secrets } from '../lib/crypto.js'
import type { Logger } from '../lib/logger.js'

/**
 * Who may call a procedure. Set with `.meta({ access })`; a procedure without it is `dashboard`.
 *
 * - `public`: anyone the dashboard server forwards, such as the landing page's waitlist form.
 * - `account`: a signed-in account with a verified address. It sees only its own account.
 * - `dashboard`: everything else. Only someone signed in with the dashboard password.
 *
 * An account never counts for `dashboard`, whatever its access status, and whatever organizations
 * it belongs to.
 */
export type Access = 'public' | 'account' | 'dashboard'

export interface ApiMeta {
  access?: Access
}

/**
 * How the dashboard server says that the visitor signed in with the dashboard password. The API
 * can't check the password itself (it lives on the dashboard server), so it trusts the server
 * that holds the internal token, and refuses every dashboard procedure without this. Must match
 * apps/web/src/server/api.ts.
 */
export const ACCESS_HEADER = 'x-apphq-access'
export const DASHBOARD_ACCESS = 'dashboard'

/**
 * Everything a request brings. A dashboard procedure also gets `organizationId` (see
 * `procedure`); the others have none, so they cannot reach any organization's data.
 */
export interface ApiContext {
  db: Db
  sql: Sql
  secrets: Secrets
  log: Logger
  /** The request carries the dashboard server's statement of dashboard access. */
  dashboardAccess: boolean
  /** Null when accounts are not set up on this server. */
  accounts: Accounts | null
  /** The account behind the request's cookie, looked up at most once per request. */
  account: () => Promise<AccountUser | null>
  /** The organization a dashboard-password session works in; see organizations/dashboard.ts. */
  dashboardOrganization: () => Promise<string>
}

const t = initTRPC.context<ApiContext>().meta<ApiMeta>().create()

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
      if (!ctx.dashboardAccess) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Sign in to the dashboard first.' })
      }
      return next()
    default:
      throw new TRPCError({ code: 'FORBIDDEN', message: 'This procedure has no access rule.' })
  }
})

/**
 * The organization a dashboard procedure reads and writes in, put in the context after the guard
 * has accepted the request. Today that is always the dashboard password's organization: no
 * account session, membership or active organization is consulted.
 */
const inOrganization = t.middleware(async ({ ctx, meta, next }) => {
  if ((meta?.access ?? 'dashboard') !== 'dashboard' || !ctx.dashboardAccess) {
    // Public and account procedures are built from `openProcedure` and never get here.
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Sign in to the dashboard first.' })
  }
  const organizationId = await ctx.dashboardOrganization()
  return next({ ctx: { organizationId } })
})

export const router = t.router

/**
 * Dashboard procedures. Every procedure passes the guard; these then get the organization they
 * work in as `ctx.organizationId`, and every query and write takes it from there.
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
