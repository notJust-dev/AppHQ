import '@tanstack/react-start/server-only'
import { getRequest } from '@tanstack/react-start/server'
import { TRPCClientError } from '@trpc/client'
import { authCookies } from './accounts'
import { ACCESS_HEADER, DASHBOARD_ACCESS, apiClient } from './api-client'
import { serverEnv } from './env'
import { isPasswordSession } from './password-session'
import { getAppSession } from './session'

/** How the visitor got into the dashboard, and the organization they work in there. */
export interface DashboardAccess {
  via: 'password' | 'account'
  /** The organization's name, as the API says; null when the API could not be asked. */
  organization: string | null
}

interface Resolved extends DashboardAccess {
  /** What carries this access to the API. Never leaves this server. */
  headers: Record<string, string>
}

/**
 * Whether this visitor may use the dashboard, and how. This is the only definition on this
 * server; the API decides again on every call, and decides which organization.
 *
 * - A password session: a session cookie with the fingerprint of the current DASHBOARD_PASSWORD
 *   (see password-session.ts). Nothing when the password is unset. Calls carry the password
 *   statement, which the API accepts only while its ALLOW_DASHBOARD_PASSWORD is on.
 * - Otherwise, or when the API refuses the password, an account (Google, GitHub, or an email
 *   address with a password): calls carry its Better Auth cookies, and it counts
 *   only if the API says which organization it works in: a verified address and a membership,
 *   from approval or an invitation.
 *
 * Exactly one of the two travels on a call, never both.
 */
async function resolve(): Promise<Resolved | null> {
  const env = serverEnv()
  const session = await getAppSession()
  const cookie = authCookies()
  const candidates: { via: DashboardAccess['via']; headers: Record<string, string> }[] = []
  if (isPasswordSession(session.password, env.DASHBOARD_PASSWORD, env.SESSION_SECRET)) {
    candidates.push({ via: 'password', headers: { [ACCESS_HEADER]: DASHBOARD_ACCESS } })
  }
  if (cookie) candidates.push({ via: 'account', headers: { cookie } })

  // The password first, as before; if the API refuses it (ALLOW_DASHBOARD_PASSWORD is off), the
  // account, if the visitor has one too.
  for (const { via, headers } of candidates) {
    try {
      const { name } = await apiClient(headers).organization.current.query()
      return { via, organization: name, headers }
    } catch (err) {
      // The API refused: an account without access, or a password the API no longer accepts.
      if (err instanceof TRPCClientError) {
        const code = (err.data as { code?: string } | undefined)?.code
        if (code === 'FORBIDDEN' || code === 'UNAUTHORIZED' || code === 'NOT_FOUND') continue
      }
      // The API could not be asked. A password session is still one (its calls fail on their
      // own, as before); an account can't be confirmed, so it gets nothing.
      return via === 'password' ? { via, organization: null, headers } : null
    }
  }
  return null
}

/** Worked out at most once per request; several checks in one request share it. */
const perRequest = new WeakMap<Request, Promise<Resolved | null>>()

function resolved(): Promise<Resolved | null> {
  let request: Request | undefined
  try {
    request = getRequest()
  } catch {
    request = undefined
  }
  if (!request) return resolve()
  let found = perRequest.get(request)
  if (!found) {
    found = resolve()
    perRequest.set(request, found)
  }
  return found
}

export async function dashboardAccess(): Promise<DashboardAccess | null> {
  const found = await resolved()
  return found ? { via: found.via, organization: found.organization } : null
}

export async function hasDashboardAccess(): Promise<boolean> {
  return (await resolved()) !== null
}

/** For `dashboardApi` only: the headers that carry the visitor's access, or null without it. */
export async function dashboardHeaders(): Promise<Record<string, string> | null> {
  return (await resolved())?.headers ?? null
}
