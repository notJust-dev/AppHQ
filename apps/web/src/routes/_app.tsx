import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'
import { AppSidebar } from '@/components/AppSidebar'
import { LANDING_META, LandingPage } from '@/components/Landing'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { getSessionFn } from '@/fns/auth'
import { appsQuery } from '@/lib/queries'

/**
 * Everything behind the login. This guard is for navigation; the data is guarded separately.
 * The one exception is the bare address: a signed-out visitor there gets the public landing
 * page instead of the dashboard, and no private data is loaded for them.
 */
export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ location }) => {
    const { signedIn, sidebarOpen } = await getSessionFn()
    if (!signedIn && location.pathname !== '/') throw redirect({ to: '/login' })
    return { signedIn, sidebarOpen }
  },
  // The sidebar lists the apps; loading them here keeps it from appearing empty.
  loader: async ({ context }) => {
    if (context.signedIn) await context.queryClient.ensureQueryData(appsQuery())
    return { signedIn: context.signedIn }
  },
  head: ({ loaderData }) => (loaderData?.signedIn === false ? { meta: LANDING_META } : {}),
  component: AppShell,
})

/**
 * The sidebar beside the page. On wide screens it collapses to icons; on a phone it opens over
 * the page from the button in each page's top bar.
 */
function AppShell() {
  const { signedIn, sidebarOpen } = Route.useRouteContext()
  if (!signedIn) return <LandingPage />
  return (
    <SidebarProvider defaultOpen={sidebarOpen}>
      <AppSidebar />
      <SidebarInset className="min-w-0">
        <Outlet />
      </SidebarInset>
    </SidebarProvider>
  )
}
