import { useSuspenseQuery } from '@tanstack/react-query'
import { Link, createFileRoute, notFound } from '@tanstack/react-router'
import { RangeSwitch } from '../../components/RangeSwitch'
import { Timeline } from '../../components/Timeline'
import { formatDay } from '../../lib/format'
import { timelineQuery } from '../../lib/queries'
import { RANGE_DAYS, rangeSearchSchema, rangeToDates } from '../../lib/range'

export const Route = createFileRoute('/_app/apps/$appId')({
  validateSearch: rangeSearchSchema,
  loaderDeps: ({ search }) => ({ range: search.range }),
  loader: async ({ context, params, deps }) => {
    const timeline = await context.queryClient.ensureQueryData(
      timelineQuery(params.appId, rangeToDates(deps.range)),
    )
    if (!timeline) throw notFound()
  },
  component: AppPage,
  notFoundComponent: AppNotFound,
})

function AppPage() {
  const { appId } = Route.useParams()
  const { range } = Route.useSearch()
  const { data } = useSuspenseQuery(timelineQuery(appId, rangeToDates(range)))
  // The loader has already turned a missing app into the not-found page.
  if (!data) return null

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">{data.app.name}</h1>
          <p className="mt-1 text-sm text-ink-soft">
            {formatDay(data.range.from)} to {formatDay(data.range.to)}, {RANGE_DAYS[range]} days
          </p>
        </div>
        <RangeSwitch current={range} />
      </div>
      <div className="mt-8">
        <Timeline days={data.days} series={data.series} />
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
        <Link to="/" className="font-medium text-ink underline">
          Go to the portfolio
        </Link>
      </p>
    </div>
  )
}
