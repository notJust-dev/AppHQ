import '@tanstack/react-start/server-only'
import { dashboardHeaders } from './access'
import { authCookies } from './accounts'
import { apiClient, type Api } from './api-client'

export type { Api } from './api-client'

/** For public procedures, such as the waitlist: the internal token and nothing about the visitor. */
export function publicApi(): Api {
  return apiClient({})
}

/** For the visitor's own account: also their Better Auth cookies, and no other cookie. */
export function accountApi(): Api {
  const cookie = authCookies()
  return apiClient(cookie ? { cookie } : {})
}

/**
 * For dashboard procedures. Null unless the visitor has dashboard access (see `access.ts`), so
 * code that forgot to check has no client to call the dashboard with. It carries either the
 * password statement or the account's cookies, never both. Server functions get it from
 * `requireDashboardAccess` in fns/auth.ts.
 */
export async function dashboardApi(): Promise<Api | null> {
  const headers = await dashboardHeaders()
  return headers ? apiClient(headers) : null
}
