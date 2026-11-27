import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { createColumnHelper, useTable } from '@tanstack/react-table'
import { Search } from 'lucide-react'
import { useMemo } from 'react'
import { DataTable, sortableFeatures, type SortableFeatures } from '@/components/DataTable'
import { PageBody } from '@/components/PageHeader'
import { Panel } from '@/components/Panel'
import { AppComparison } from '@/components/performance/AppComparison'
import { ChartRow, ChartStack } from '@/components/performance/ChartStack'
import { DailyChart } from '@/components/performance/DailyChart'
import { PerformanceHeader } from '@/components/performance/PerformanceHeader'
import { Stat, StatGrid } from '@/components/performance/Stat'
import { Button } from '@/components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { formatCompact, formatCount, formatDay } from '@/lib/format'
import { usePrivacy } from '@/lib/privacy'
import { searchPerformanceQuery, searchTopQuery, type PerformanceSeries } from '@/lib/queries'
import { rangeToDates } from '@/lib/range'

export const Route = createFileRoute('/_app/seo')({
  loaderDeps: ({ search }) => ({ range: search.range, app: search.app }),
  loader: ({ context, deps }) =>
    context.queryClient.ensureQueryData(searchPerformanceQuery({ ...rangeToDates(deps.range), appId: deps.app })),
  component: SeoPage,
})

const percent = (value: number) => `${(value * 100).toFixed(1)}%`
const position = (value: number) => value.toFixed(1)
const ratio = (top: number | null | undefined, bottom: number | null | undefined) =>
  top !== null && top !== undefined && bottom ? top / bottom : null

function SeoPage() {
  const { range, app } = Route.useSearch()
  const dates = rangeToDates(range)
  const { data } = useSuspenseQuery(searchPerformanceQuery({ ...dates, appId: app }))
  const series = (key: string) => data.series.find((entry) => entry.key === key)
  const clicks = series('clicks')
  const impressions = series('impressions')
  const positionSum = series('positionSum')
  const dailyPosition = data.days.map((_, index) => ratio(positionSum?.values[index], impressions?.values[index]))
  const dailyCtr = data.days.map((_, index) => ratio(clicks?.values[index], impressions?.values[index]))

  const header = (
    <PerformanceHeader
      title="SEO"
      description="How your apps' websites do in Google search, from Search Console."
      range={range}

      dates={dates}
    />
  )

  if (impressions?.summary == null) {
    return (
      <>
        {header}
        <PageBody>
          <NoSearch />
        </PageBody>
      </>
    )
  }

  return (
    <>
      {header}
      <PageBody>
        <StatGrid columns={4}>
          <Stat label="Clicks" swatch="bg-views" value={clicks?.summary ?? null} previous={clicks?.previous} format={formatCompact} />
          <Stat label="Impressions" swatch="bg-views/50" value={impressions.summary} previous={impressions.previous} format={formatCompact} />
          <Stat
            label="Click-through rate"
            value={ratio(clicks?.summary, impressions.summary)}
            previous={ratio(clicks?.previous, impressions.previous)}
            format={percent}
          />
          <Stat
            label="Average position, lower is better"
            value={ratio(positionSum?.summary, impressions.summary)}
            previous={ratio(positionSum?.previous, impressions.previous)}
            format={position}
            better="down"
          />
        </StatGrid>

        <Panel
          title="Day by day"
          description={`Google search for the linked websites${through(impressions)}. Position is the average rank of the pages shown, weighted by impressions; 1 is the top.`}
          bodyClassName="pb-3"
        >
          <ChartStack>
            <ChartRow label="Clicks" swatch="bg-views" summary={clicks?.summary != null ? formatCount(clicks.summary) : undefined}>
              <DailyChart days={data.days} values={clicks?.values ?? []} label="Clicks" color="var(--views)" />
            </ChartRow>
            <ChartRow label="Impressions" swatch="bg-views/50" summary={formatCount(impressions.summary)}>
              <DailyChart
                days={data.days}
                values={impressions.values}
                label="Impressions"
                color="color-mix(in oklab, var(--views) 50%, transparent)"
              />
            </ChartRow>
            <ChartRow label="Click-through rate" swatch="bg-foreground">
              <DailyChart days={data.days} values={dailyCtr} label="Click-through rate" unit="percent" color="var(--foreground)" kind="line" height={140} />
            </ChartRow>
            <ChartRow label="Average position" swatch="bg-foreground" summary="lower is better">
              <DailyChart days={data.days} values={dailyPosition} label="Average position" unit="ratio" color="var(--foreground)" kind="line" height={140} />
            </ChartRow>
          </ChartStack>
        </Panel>

        <div className="grid gap-6 xl:grid-cols-2">
          <TopPanel title="Top queries" heading="Query" dimension="query" dates={dates} app={app} />
          <TopPanel title="Top pages" heading="Page" dimension="page" dates={dates} app={app} />
        </div>

        {!app && data.apps.length > 1 && (
          <Panel title="By app" description="Each app's website over the same days. Select a column heading to sort by it." bodyClassName="">
            <AppComparison
              sortBy="clicks"
              rows={data.apps.map((entry) => ({
                app: entry.app,
                values: {
                  clicks: entry.totals.clicks,
                  impressions: entry.totals.impressions,
                  ctr: ratio(entry.totals.clicks, entry.totals.impressions),
                  position: ratio(entry.totals.positionSum, entry.totals.impressions),
                },
              }))}
              columns={[
                { key: 'clicks', label: 'Clicks', format: formatCount },
                { key: 'impressions', label: 'Impressions', format: formatCount },
                { key: 'ctr', label: 'Click-through rate', format: percent },
                { key: 'position', label: 'Average position', format: position },
              ]}
            />
          </Panel>
        )}
      </PageBody>
    </>
  )
}

const through = (series: PerformanceSeries | undefined) =>
  series?.completeThrough ? `, through ${formatDay(series.completeThrough)}` : ''

/** The top queries or pages, read live from Search Console after the page has drawn. */
function TopPanel(props: {
  title: string
  heading: string
  dimension: 'query' | 'page'
  dates: { from: string; to: string }
  app: string | undefined
}) {
  const { data, isPending } = useQuery(searchTopQuery({ ...props.dates, appId: props.app, dimension: props.dimension }))
  const hasRows = data?.ok === true && data.connected && data.rows.length > 0

  return (
    <Panel
      title={props.title}
      description={`The most clicked over the range, read from Search Console.${hasRows ? ' Select a column heading to sort by it.' : ''}`}
      bodyClassName=""
    >
      {isPending ? (
        <div className="space-y-2 px-5 py-4" aria-label="Loading">
          {[0, 1, 2, 3, 4].map((index) => (
            <Skeleton key={index} className="h-6 w-full" />
          ))}
        </div>
      ) : !data?.ok ? (
        <p className="px-5 py-4 text-destructive">{data?.message ?? 'Could not read Search Console.'}</p>
      ) : !data.connected ? (
        <p className="px-5 py-4 text-muted-foreground">
          These are read from Search Console as the page opens.{' '}
          <Link to="/accounts/search-console" className="font-medium text-foreground underline underline-offset-4">
            Connect it
          </Link>{' '}
          to see them.
        </p>
      ) : data.rows.length === 0 ? (
        <p className="px-5 py-4 text-muted-foreground">Nothing in this range.</p>
      ) : (
        <SearchTopTable rows={data.rows} heading={props.heading} dimension={props.dimension} />
      )}
    </Panel>
  )
}

interface SearchTopRow {
  key: string
  clicks: number
  impressions: number
  position: number
}

const topHelper = createColumnHelper<SortableFeatures, SearchTopRow>()

const topCount = (key: 'clicks' | 'impressions', label: string, width: string) =>
  topHelper.accessor(key, {
    header: label,
    sortDescFirst: true,
    meta: { align: 'right', headClassName: width, cellClassName: 'figures' },
    cell: (info) => formatCount(info.getValue()),
  })

/** A page as people read it: its host and path, without the scheme. */
const pageLabel = (key: string) => {
  try {
    const url = new URL(key)
    return `${url.host}${url.pathname === '/' ? '' : url.pathname}`
  } catch {
    return key
  }
}

function SearchTopTable(props: { rows: SearchTopRow[]; heading: string; dimension: 'query' | 'page' }) {
  const privacy = usePrivacy()
  const { heading, dimension } = props
  const columns = useMemo(
    () =>
      topHelper.columns([
        topHelper.accessor('key', {
          header: heading,
          sortFn: 'alphanumeric',
          meta: { cellClassName: 'truncate font-normal' },
          cell: (info) => {
            const key = info.getValue()
            // A search term or page names the site; a native tooltip could not be blurred.
            const title = privacy ? undefined : key
            return dimension === 'page' ? (
              <a href={key} target="_blank" rel="noreferrer" data-private="" title={title} className="hover:underline">
                {pageLabel(key)}
              </a>
            ) : (
              <span data-private="" title={title}>
                {key}
              </span>
            )
          },
        }),
        topCount('clicks', 'Clicks', 'w-20'),
        topCount('impressions', 'Impressions', 'w-28'),
        // Lower is better, so the best rank comes first.
        topHelper.accessor('position', {
          header: 'Position',
          sortDescFirst: false,
          meta: { align: 'right', headClassName: 'w-28', cellClassName: 'figures' },
          cell: (info) => position(info.getValue()),
        }),
      ]),
    [heading, dimension, privacy],
  )

  const table = useTable({
    features: sortableFeatures,
    columns,
    data: props.rows,
    initialState: { sorting: [{ id: 'clicks', desc: true }] },
    enableSortingRemoval: false,
  })

  return <DataTable table={table} className="table-fixed" />
}

function NoSearch() {
  return (
    <Empty className="border border-dashed bg-card">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Search />
        </EmptyMedia>
        <EmptyTitle>No search numbers in this range</EmptyTitle>
        <EmptyDescription>
          Connect Google Search Console with a service account added to your websites, then link each website to
          its app. Sixteen months of history are fetched.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="flex-row justify-center">
        <Button asChild>
          <Link to="/accounts/search-console">Connect Search Console</Link>
        </Button>
      </EmptyContent>
    </Empty>
  )
}
