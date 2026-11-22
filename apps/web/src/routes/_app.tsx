import { useQueryClient } from '@tanstack/react-query'
import { Link, Outlet, createFileRoute, redirect, useLocation, useRouter } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { Menu, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { BrandMark } from '../components/ui/Brand'
import { Sidebar } from '../components/ui/Sidebar'
import { getSessionFn, signOutFn } from '../fns/auth'
import { appsQuery } from '../lib/queries'

/** Everything behind the login. This guard is for navigation; the data is guarded separately. */
export const Route = createFileRoute('/_app')({
  beforeLoad: async () => {
    const { signedIn } = await getSessionFn()
    if (!signedIn) throw redirect({ to: '/login' })
  },
  // The sidebar lists the apps; loading them here keeps it from appearing empty.
  loader: ({ context }) => context.queryClient.ensureQueryData(appsQuery()),
  component: AppShell,
})

/** A sidebar on wide screens; on a phone, a top bar whose menu opens the same sidebar. */
function AppShell() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const signOut = useServerFn(signOutFn)
  const [menuOpen, setMenuOpen] = useState(false)
  const { pathname } = useLocation()

  // A new page closes the menu, whichever way the person got there.
  useEffect(() => setMenuOpen(false), [pathname])
  useEffect(() => {
    if (!menuOpen) return
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setMenuOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menuOpen])

  const onSignOut = async () => {
    await signOut()
    queryClient.clear()
    await router.navigate({ to: '/login' })
  }

  return (
    <div className="lg:flex">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 border-r border-line bg-paper lg:block">
        <Sidebar onSignOut={onSignOut} />
      </aside>

      <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-line bg-surface px-4 lg:hidden">
        <Link to="/" className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
          <BrandMark />
          AppDashboard
        </Link>
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-label="Open menu"
          aria-expanded={menuOpen}
          className="grid size-9 cursor-pointer place-items-center rounded-md text-ink-soft hover:bg-raised hover:text-ink"
        >
          <Menu className="size-5" aria-hidden="true" />
        </button>
      </header>

      {menuOpen && (
        <div className="fixed inset-0 z-30 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 cursor-default bg-black/50"
            onClick={() => setMenuOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] border-r border-line bg-paper shadow-xl">
            <button
              type="button"
              onClick={() => setMenuOpen(false)}
              aria-label="Close menu"
              className="absolute top-3 right-3 grid size-8 cursor-pointer place-items-center rounded-md text-ink-soft hover:bg-raised hover:text-ink"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
            <Sidebar onNavigate={() => setMenuOpen(false)} onSignOut={onSignOut} />
          </div>
        </div>
      )}

      <main className="min-w-0 flex-1">
        <Outlet />
      </main>
    </div>
  )
}
