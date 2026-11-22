import { useSuspenseQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { AppsTable } from '../../components/AppsTable'
import { buttonClass } from '../../components/Button'
import { FunnelBand } from '../../components/FunnelBand'
import { RangeSwitch } from '../../components/RangeSwitch'
import { PageBody, PageHeader } from '../../components/ui/PageHeader'
import { Panel } from '../../components/ui/Panel'
import { formatDay } from '../../lib/format'
import { overviewQuery } from '../../lib/queries'
import { RANGE_DAYS, rangeSearchSchema, rangeToDates } from '../../lib/range'

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
          <Panel title="No apps yet">
            <p className="max-w-prose text-ink-soft">
              Connect App Store Connect, Google Play or your social accounts, then add the apps you
              want to track.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link to="/accounts" className={buttonClass('primary')}>
                Connect accounts
              </Link>
              <Link to="/apps/new" className={buttonClass('secondary')}>
                Add app
              </Link>
            </div>
          </Panel>
        ) : (
          <>
            <FunnelBand
              totals={data.totals}
              previous={data.comparable ? data.previousTotals : null}
              comparedWith={`vs previous ${days} days`}
            />
            <Panel title="Apps" description="Each app's funnel over the same days, most revenue first." bodyClassName="">
              <AppsTable apps={data.apps} range={range} />
            </Panel>
          </>
        )}
      </PageBody>
    </>
  )
}
