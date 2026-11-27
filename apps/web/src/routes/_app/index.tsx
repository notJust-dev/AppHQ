import { useSuspenseQuery } from '@tanstack/react-query'
import { Link, createFileRoute, redirect } from '@tanstack/react-router'
import { ArrowRight, Inbox, LayoutDashboard, Settings } from 'lucide-react'
import { AppOverview } from '@/components/AppOverview'
import { AppsTable } from '@/components/AppsTable'
import { FunnelBand } from '@/components/FunnelBand'
import { PageBody, PageHeader } from '@/components/PageHeader'
import { Panel } from '@/components/Panel'
import { RangeSwitch } from '@/components/RangeSwitch'
import { Button } from '@/components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { useAttention } from '@/hooks/use-attention'
import { foundLine } from '@/lib/attention'
import { formatDay } from '@/lib/format'
import { appsQuery, flowQuery, overviewQuery, postsQuery, reportingOf, timelineQuery } from '@/lib/queries'
import { RANGE_DAYS, rangeToDates, type RangeKey } from '@/lib/range'

/**
 * Overview: every app's funnel side by side, or one app's numbers when the top bar has an app
 * chosen. Both follow the range.
 */
export const Route = createFileRoute('/_app/')({
  loaderDeps: ({ search }) => ({ range: search.range, app: search.app }),
  // Without dashboard access, `_app` shows the landing page instead, so there is nothing to load.
  loader: async ({ context, deps }) => {
    if (!context.dashboardAccess) return
    const dates = rangeToDates(deps.range)
    if (!deps.app) {
      await context.queryClient.ensureQueryData(overviewQuery(dates))
      return
    }
    const known = (list: { id: string }[]) => list.some((app) => app.id === deps.app)
    // The list may be cached from before the app was added, so ask again before giving up.
    const found =
      known(await context.queryClient.ensureQueryData(appsQuery())) ||
      known(await context.queryClient.fetchQuery({ ...appsQuery(), staleTime: 0 }))
    // An app that was removed, or an address from before: every app instead.
    if (!found) throw redirect({ to: '/', search: (previous) => ({ ...previous, app: undefined }), replace: true })
    const [timeline] = await Promise.all([
      context.queryClient.ensureQueryData(timelineQuery(deps.app, dates)),
      context.queryClient.ensureQueryData(postsQuery(deps.app, dates)),
      context.queryClient.ensureQueryData(flowQuery(deps.app, dates)),
    ])
    if (!timeline) throw redirect({ to: '/', search: (previous) => ({ ...previous, app: undefined }), replace: true })
  },
  component: OverviewPage,
})

function OverviewPage() {
  const { range, app } = Route.useSearch()
  const dates = rangeToDates(range)

  return (
    <>
      <PageHeader
        title="Overview"
        scoped
        description={`${formatDay(dates.from)} to ${formatDay(dates.to)}, compared with the ${RANGE_DAYS[range]} days before`}
        actions={
          <>
            {app && (
              <Button asChild variant="outline">
                <Link to="/settings/apps/$appId" params={{ appId: app }}>
                  <Settings aria-hidden="true" />
                  Settings
                </Link>
              </Button>
            )}
            <RangeSwitch current={range} />
          </>
        }
      />
      <PageBody>
        <WaitingSources />
        {app ? <AppOverview appId={app} dates={dates} /> : <Portfolio range={range} />}
      </PageBody>
    </>
  )
}

/**
 * One line when an integration found sources that belong to no app yet, such as a new app on
 * App Store Connect: they count nowhere until someone decides, on Settings › Apps.
 */
function WaitingSources() {
  const { waiting } = useAttention()
  if (waiting.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-warning-soft px-4 py-2.5 text-sm text-warning">
      <Inbox aria-hidden="true" className="size-4 shrink-0" />
      <span className="font-medium">{foundLine(waiting)}.</span>
      <Link to="/settings/apps" className="inline-flex items-center gap-1 font-medium underline underline-offset-4">
        Review
        <ArrowRight aria-hidden="true" className="size-3.5" />
      </Link>
    </div>
  )
}

/** Every app at once: the funnel added up, then each app's. */
function Portfolio({ range }: { range: RangeKey }) {
  const { data } = useSuspenseQuery(overviewQuery(rangeToDates(range)))

  if (data.apps.length === 0) {
    return (
      <Empty className="border border-dashed bg-card">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <LayoutDashboard />
          </EmptyMedia>
          <EmptyTitle>No apps yet</EmptyTitle>
          <EmptyDescription>
            Connect App Store Connect, Google Play or your social accounts, then add the apps you want to track.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent className="flex-row justify-center">
          <Button asChild>
            <Link to="/settings/integrations">Connect accounts</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/settings/apps/new">Add app</Link>
          </Button>
        </EmptyContent>
      </Empty>
    )
  }

  return (
    <>
      <FunnelBand
        totals={data.totals}
        previous={data.comparable ? data.previousTotals : null}
        reporting={reportingOf(data.reporting)}
      />
      <Panel title="Apps" description="Each app's funnel over the same days. Select a column heading to sort by it." bodyClassName="">
        <AppsTable apps={data.apps} />
      </Panel>
    </>
  )
}
