import { useQueryClient } from '@tanstack/react-query'
import { Link, Outlet, createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { getSessionFn, signOutFn } from '../fns/auth'

/** Everything behind the login. This guard is for navigation; the data is guarded separately. */
export const Route = createFileRoute('/_app')({
  beforeLoad: async () => {
    const { signedIn } = await getSessionFn()
    if (!signedIn) throw redirect({ to: '/login' })
  },
  component: AppShell,
})

function AppShell() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const signOut = useServerFn(signOutFn)

  return (
    <>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-6 sm:gap-8">
          <Link to="/" className="font-display text-lg font-semibold tracking-tight">
            AppDashboard
          </Link>
          <nav aria-label="Sections" className="flex gap-4 text-sm font-medium sm:gap-6">
            <Link
              to="/"
              className="text-ink-soft hover:text-ink"
              activeProps={{ className: 'text-ink' }}
              activeOptions={{ exact: true }}
            >
              Portfolio
            </Link>
            <Link
              to="/settings"
              className="text-ink-soft hover:text-ink"
              activeProps={{ className: 'text-ink' }}
            >
              Settings
            </Link>
          </nav>
          <button
            type="button"
            className="ml-auto cursor-pointer text-sm font-medium whitespace-nowrap text-ink-soft hover:text-ink"
            onClick={async () => {
              await signOut()
              queryClient.clear()
              await router.navigate({ to: '/login' })
            }}
          >
            Sign out
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-10">
        <Outlet />
      </main>
    </>
  )
}
