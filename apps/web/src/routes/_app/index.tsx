import { useSuspenseQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { LayoutDashboard } from 'lucide-react'
import { AppsTable } from '@/components/AppsTable'
import { FunnelBand } from '@/components/FunnelBand'
import { PageBody, PageHeader } from '@/components/PageHeader'
import { Panel } from '@/components/Panel'
import { RangeSwitch } from '@/components/RangeSwitch'
import { Button } from '@/components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { formatDay } from '@/lib/format'
import { overviewQuery, reportingOf } from '@/lib/queries'
import { RANGE_DAYS, rangeSearchSchema, rangeToDates } from '@/lib/range'

export const Route = createFileRoute('/_app/')({
  validateSearch: rangeSearchSchema,
  loaderDeps: ({ search }) => ({ range: search.range }),
  loader: ({ context, deps }) =>
    context.queryClient.ensureQueryData(overviewQuery(rangeToDates(deps.range))),
  component: PortfolioPage,
})

function PortfolioPage() {
  const { range } = Route.useSearch()
  const { data } = useSuspenseQuery(overviewQuery(rangeToDates(range)))
  const days = RANGE_DAYS[range]

  return (
    <>
      <PageHeader
        title="Portfolio"
        description={`${formatDay(data.range.from)} to ${formatDay(data.range.to)}, compared with the ${days} days before`}
        actions={<RangeSwitch current={range} />}
      />
      <PageBody>
        {data.apps.length === 0 ? (
          <Empty className="border border-dashed bg-card">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <LayoutDashboard />
              </EmptyMedia>
              <EmptyTitle>No apps yet</EmptyTitle>
              <EmptyDescription>
                Connect App Store Connect, Google Play or your social accounts, then add the apps you
                want to track.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent className="flex-row justify-center">
              <Button asChild>
                <Link to="/accounts">Connect accounts</Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/apps/new">Add app</Link>
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <>
            <FunnelBand
              totals={data.totals}
              previous={data.comparable ? data.previousTotals : null}
              reporting={reportingOf(data.reporting)}
              comparedWith={`vs previous ${days} days`}
            />
            <Panel title="Apps" description="Each app's funnel over the same days. Select a column heading to sort by it." bodyClassName="">
              <AppsTable apps={data.apps} range={range} />
            </Panel>
          </>
        )}
      </PageBody>
    </>
  )
}
