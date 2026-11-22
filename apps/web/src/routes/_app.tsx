import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'
import { AppSidebar } from '@/components/AppSidebar'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { getSessionFn } from '@/fns/auth'
import { appsQuery } from '@/lib/queries'

/** Everything behind the login. This guard is for navigation; the data is guarded separately. */
export const Route = createFileRoute('/_app')({
  beforeLoad: async () => {
    const { signedIn, sidebarOpen } = await getSessionFn()
    if (!signedIn) throw redirect({ to: '/login' })
    return { sidebarOpen }
  },
  // The sidebar lists the apps; loading them here keeps it from appearing empty.
  loader: ({ context }) => context.queryClient.ensureQueryData(appsQuery()),
  component: AppShell,
})

/**
 * The sidebar beside the page. On wide screens it collapses to icons; on a phone it opens over
 * the page from the button in each page's top bar.
 */
function AppShell() {
  const { sidebarOpen } = Route.useRouteContext()
  return (
    <SidebarProvider defaultOpen={sidebarOpen}>
      <AppSidebar />
      <SidebarInset className="min-w-0">
        <Outlet />
      </SidebarInset>
    </SidebarProvider>
  )
}
