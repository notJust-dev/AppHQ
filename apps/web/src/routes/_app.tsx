import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'
import { useEffect } from 'react'
import { AppSidebar } from '@/components/AppSidebar'
import { LANDING_META, LandingPage } from '@/components/Landing'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { getAccountFn } from '@/fns/account'
import { getSessionFn } from '@/fns/auth'
import { setSignedIn } from '@/lib/analytics'
import { appsQuery } from '@/lib/queries'
import { dashboardSearchMiddlewares, dashboardSearchSchema } from '@/lib/range'

/**
 * Everything behind sign-in. This guard is for navigation; the data is guarded separately, by
 * `requireDashboardAccess` in every server function and by the API.
 *
 * - Dashboard access (the dashboard password, or an approved member account; see
 *   server/access.ts): the dashboard, in the organization the API chose.
 * - Signed in with an account without access: the Request access page, from every dashboard
 *   address including the bare one.
 * - Neither: the bare address shows the public landing page, with no private data loaded; any
 *   other address goes to /login.
 */
export const Route = createFileRoute('/_app')({
  // The app and range every page here reads, kept from one page to the next.
  validateSearch: dashboardSearchSchema,
  search: { middlewares: dashboardSearchMiddlewares },
  beforeLoad: async ({ location }) => {
    const { dashboardAccess, organization, sidebarOpen } = await getSessionFn()
    if (dashboardAccess) return { dashboardAccess, organization, sidebarOpen }

    const { account } = await getAccountFn()
    if (account) throw redirect({ to: '/request-access' })
    if (location.pathname !== '/') throw redirect({ to: '/login' })
    return { dashboardAccess, organization, sidebarOpen }
  },
  // The sidebar lists the apps; loading them here keeps it from appearing empty.
  loader: async ({ context }) => {
    if (context.dashboardAccess) await context.queryClient.ensureQueryData(appsQuery())
    return { dashboardAccess: context.dashboardAccess }
  },
  head: ({ loaderData }) => (loaderData?.dashboardAccess === false ? { meta: LANDING_META } : {}),
  component: AppShell,
})

/**
 * The sidebar beside the page. On wide screens it collapses to icons; on a phone it opens over
 * the page from the button in each page's top bar.
 */
function AppShell() {
  const { dashboardAccess, organization, sidebarOpen } = Route.useRouteContext()
  useEffect(() => setSignedIn(dashboardAccess), [dashboardAccess])
  if (!dashboardAccess) return <LandingPage />
  return (
    <SidebarProvider defaultOpen={sidebarOpen}>
      <AppSidebar organization={organization} />
      <SidebarInset className="min-w-0">
        <Outlet />
      </SidebarInset>
    </SidebarProvider>
  )
}
