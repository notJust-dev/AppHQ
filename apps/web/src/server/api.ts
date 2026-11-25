import '@tanstack/react-start/server-only'
import { createTRPCClient, httpLink } from '@trpc/client'
// Type-only: erased at build time, so this app never bundles or depends on the API's code.
import type { AppRouter } from '../../../api/src/trpc/router'
import { hasDashboardAccess } from './access'
import { authCookies } from './accounts'
import { serverEnv } from './env'

/**
 * How this server tells the API that the visitor signed in with the dashboard password. Without
 * it the API refuses every dashboard procedure. Must match apps/api/src/trpc/init.ts.
 */
const ACCESS_HEADER = 'x-apphq-access'
const DASHBOARD_ACCESS = 'dashboard'

/**
 * A client for one call. Each carries its own visitor's headers, so calls from two visitors can
 * never travel together in one batch. The internal token stays on this server; the browser talks
 * to this app's server functions, never to the API.
 */
function client(headers: Record<string, string>) {
  const env = serverEnv()
  return createTRPCClient<AppRouter>({
    links: [httpLink({ url: `${env.API_URL}/trpc`, headers: { authorization: `Bearer ${env.INTERNAL_API_TOKEN}`, ...headers } })],
  })
}

export type Api = ReturnType<typeof client>

/** For public procedures, such as the waitlist: the internal token and nothing about the visitor. */
export function publicApi(): Api {
  return client({})
}

/** For the visitor's own account: also their Better Auth cookies, and no other cookie. */
export function accountApi(): Api {
  const cookie = authCookies()
  return client(cookie ? { cookie } : {})
}

/**
 * For dashboard procedures. Null unless the visitor signed in with the dashboard password, so
 * code that forgot to check has no client to call the dashboard with. Server functions get it
 * from `requireDashboardAccess` in fns/auth.ts.
 */
export async function dashboardApi(): Promise<Api | null> {
  if (!(await hasDashboardAccess())) return null
  return client({ [ACCESS_HEADER]: DASHBOARD_ACCESS })
}
