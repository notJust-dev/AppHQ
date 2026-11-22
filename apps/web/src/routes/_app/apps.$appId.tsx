import { useSuspenseQuery } from '@tanstack/react-query'
import { Link, Outlet, createFileRoute, notFound } from '@tanstack/react-router'
import { AppIcon } from '@/components/AppIcon'
import { PageBody, PageHeader, TAB_CLASS } from '@/components/PageHeader'
import { appsQuery } from '@/lib/queries'
import { rangeSearchSchema } from '@/lib/range'

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

/** One app: its name and tabs on top, the tab's content below. */
function AppLayout() {
  const { appId } = Route.useParams()
  const { data: apps } = useSuspenseQuery(appsQuery())
  const app = apps.find((entry) => entry.id === appId)
  // Gone for a moment after it is removed, while the page moves on to the Apps list.
  if (!app) return null

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Apps', to: '/apps' }]}
        title={app.name}
        privateTitle={app.kind !== 'portfolio'}
        icon={app.kind === 'portfolio' ? undefined : <AppIcon app={app} className="size-9 text-sm" />}
        tabs={
          <nav aria-label="App sections" className="flex gap-5">
            <Link
              to="/apps/$appId"
              params={{ appId }}
              search={(previous) => previous}
              activeOptions={{ exact: true, includeSearch: false }}
              className={TAB_CLASS}
            >
              Overview
            </Link>
            <Link to="/apps/$appId/settings" params={{ appId }} search={(previous) => previous} className={TAB_CLASS}>
              Settings
            </Link>
          </nav>
        }
      />
      <PageBody>
        <Outlet />
      </PageBody>
    </>
  )
}

function AppNotFound() {
  return (
    <>
      <PageHeader crumbs={[{ label: 'Apps', to: '/apps' }]} title="There is no such app" />
      <PageBody>
        <p className="text-muted-foreground">
          It may have been removed, or the address may be mistyped.{' '}
          <Link to="/apps" className="font-medium text-foreground underline underline-offset-4">
            Go to the apps
          </Link>
        </p>
      </PageBody>
    </>
  )
}
