import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { AppsTable } from '../../components/AppsTable'
import { FunnelBand } from '../../components/FunnelBand'
import { RangeSwitch } from '../../components/RangeSwitch'
import { formatDay } from '../../lib/format'
import { overviewQuery } from '../../lib/queries'
import { RANGE_DAYS, RANGE_KEYS, rangeToDates } from '../../lib/range'

const searchSchema = z.object({
  // An unknown or missing value falls back to the default instead of erroring.
  range: z.enum(RANGE_KEYS).default('28d').catch('28d'),
})

export const Route = createFileRoute('/_app/')({
  validateSearch: searchSchema,
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
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">Portfolio</h1>
          <p className="mt-1 text-sm text-ink-soft">
            {formatDay(data.range.from)} to {formatDay(data.range.to)}, compared with the {days}{' '}
            days before
          </p>
        </div>
        <RangeSwitch current={range} />
      </div>

      {data.apps.length === 0 ? (
        <div className="mt-8 rounded-lg border border-line bg-surface px-6 py-10">
          <h2 className="font-display text-xl font-semibold">No apps yet</h2>
          <p className="mt-2 max-w-prose text-sm text-ink-soft">
            The database has no apps. To load demo data, run{' '}
            <code className="rounded bg-paper px-1.5 py-0.5">npm run cli -- seed</code> in{' '}
            <code className="rounded bg-paper px-1.5 py-0.5">apps/api</code>, then reload.
          </p>
        </div>
      ) : (
        <>
          <div className="mt-8">
            <FunnelBand
              totals={data.totals}
              previous={data.comparable ? data.previousTotals : null}
              comparedWith={`vs previous ${days} days`}
            />
          </div>
          <h2 className="mt-12 mb-4 font-display text-xl font-semibold tracking-tight">Apps</h2>
          <AppsTable apps={data.apps} />
        </>
      )}
    </>
  )
}
