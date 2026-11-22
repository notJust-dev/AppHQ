import { useSuspenseQuery } from '@tanstack/react-query'
import { Link, Outlet, createFileRoute, notFound } from '@tanstack/react-router'
import { appsQuery } from '../../lib/queries'
import { rangeSearchSchema } from '../../lib/range'

/**
 * One app: its name and two tabs, Overview (`apps.$appId.index.tsx`, the numbers) and Settings
 * (`apps.$appId.settings.tsx`, what feeds it). The range stays in the address across both.
 */
export const Route = createFileRoute('/_app/apps/$appId')({
  validateSearch: rangeSearchSchema,
  loader: async ({ context, params }) => {
    const known = (list: { id: string }[]) => list.some((app) => app.id === params.appId)
    // The list may be cached from before the app was added, so ask again before giving up.
    if (known(await context.queryClient.ensureQueryData(appsQuery()))) return
    if (!known(await context.queryClient.fetchQuery({ ...appsQuery(), staleTime: 0 }))) throw notFound()
  },
  component: AppLayout,
  notFoundComponent: AppNotFound,
})

const TAB =
  '-mb-px border-b-2 border-transparent pb-3 text-ink-soft hover:text-ink aria-[current=page]:border-ink aria-[current=page]:text-ink'

function AppLayout() {
  const { appId } = Route.useParams()
  const { data: apps } = useSuspenseQuery(appsQuery())
  const app = apps.find((entry) => entry.id === appId)
  // Gone for a moment after it is removed, while the page moves on to the Apps list.
  if (!app) return null

  return (
    <>
      <h1 className="font-display text-3xl font-semibold tracking-tight">{app.name}</h1>
      <nav aria-label="App sections" className="mt-4 flex gap-6 border-b border-line text-sm font-medium">
        <Link
          to="/apps/$appId"
          params={{ appId }}
          search={(previous) => previous}
          activeOptions={{ exact: true, includeSearch: false }}
          className={TAB}
        >
          Overview
        </Link>
        <Link to="/apps/$appId/settings" params={{ appId }} search={(previous) => previous} className={TAB}>
          Settings
        </Link>
      </nav>
      <div className="mt-6">
        <Outlet />
      </div>
    </>
  )
}

function AppNotFound() {
  return (
    <div className="max-w-xl">
      <h1 className="font-display text-2xl font-semibold">There is no such app</h1>
      <p className="mt-3 text-ink-soft">
        It may have been removed, or the address may be mistyped.{' '}
        <Link to="/apps" className="font-medium text-ink underline">
          Go to the apps
        </Link>
      </p>
    </div>
  )
}
