import { useSuspenseQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { Store } from 'lucide-react'
import { NoData } from '@/components/NoData'
import { PageBody } from '@/components/PageHeader'
import { Panel } from '@/components/Panel'
import { AppComparison } from '@/components/performance/AppComparison'
import { ChartRow, ChartStack } from '@/components/performance/ChartStack'
import { DailyChart } from '@/components/performance/DailyChart'
import { PerformanceHeader } from '@/components/performance/PerformanceHeader'
import { Stat, StatGrid } from '@/components/performance/Stat'
import { Button } from '@/components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { formatCompact, formatCount, formatDay } from '@/lib/format'
import { pairedRatio } from '@/lib/performance'
import { storePerformanceQuery, type PerformanceSeries } from '@/lib/queries'
import { performanceSearchSchema, rangeToDates } from '@/lib/range'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_app/store')({
  validateSearch: performanceSearchSchema,
  loaderDeps: ({ search }) => ({ range: search.range, app: search.app }),
  loader: ({ context, deps }) =>
    context.queryClient.ensureQueryData(storePerformanceQuery({ ...rangeToDates(deps.range), appId: deps.app })),
  component: StorePage,
})

const percent = (value: number) => `${(value * 100).toFixed(1)}%`

const STORES = [
  { source: 'app_store', label: 'App Store', visits: 'Product page views' },
  { source: 'google_play', label: 'Google Play', visits: 'Store listing visitors' },
] as const

/** A series' total from one store, or null when that store reported nothing. */
const fromStore = (series: PerformanceSeries | undefined, source: string, period: 'summary' | 'previous' = 'summary') =>
  series?.sources.find((part) => part.source === source)?.[period] ?? null

function StorePage() {
  const { range, app } = Route.useSearch()
  const dates = rangeToDates(range)
  const { data } = useSuspenseQuery(storePerformanceQuery({ ...dates, appId: app }))
  const series = (key: string) => data.series.find((entry) => entry.key === key)
  const impressions = series('impressions')
  const pageViews = series('pageViews')
  const downloads = series('downloads')

  // Each rate pairs an app's numbers store by store, over the apps that report both.
  const storeRate = (top: string, bottom: string, options: { period?: 'previous'; source?: string } = {}) =>
    pairedRatio(data.apps, top, bottom, { ...options, bySource: true })

  if (pageViews?.summary == null && downloads?.summary == null) {
    return (
      <>
        <PerformanceHeader title="Store" description="From being seen in the store, to the page, to the download." range={range} app={app} dates={dates} />
        <PageBody>
          <NoStore />
        </PageBody>
      </>
    )
  }

  return (
    <>
      <PerformanceHeader
        title="Store"
        description="From being seen in the store, to the page, to the download."
        range={range}
        app={app}
        dates={dates}
      />
      <PageBody>
        <StatGrid>
          <Stat label="Impressions" swatch="bg-views" value={impressions?.summary ?? null} previous={impressions?.previous} format={formatCompact} />
          <Stat label="Store page views" swatch="bg-views" value={pageViews?.summary ?? null} previous={pageViews?.previous} format={formatCompact} />
          <Stat label="Downloads" swatch="bg-downloads" value={downloads?.summary ?? null} previous={downloads?.previous} format={formatCompact} />
          <Stat
            label="Page view to download"
            value={storeRate('downloads', 'pageViews')}
            previous={storeRate('downloads', 'pageViews', { period: 'previous' })}
            format={percent}
          />
          <Stat
            label="Impression to page view"
            value={storeRate('pageViews', 'impressions', { source: 'app_store' })}
            previous={storeRate('pageViews', 'impressions', { source: 'app_store', period: 'previous' })}
            format={percent}
          />
          <Stat
            label="Impression to download"
            value={storeRate('downloads', 'impressions', { source: 'app_store' })}
            previous={storeRate('downloads', 'impressions', { source: 'app_store', period: 'previous' })}
            format={percent}
          />
        </StatGrid>

        <Panel
          title="Funnel by store"
          description="Each step's total, and its share of the step before over the apps that report both. Only the App Store reports impressions; Google Play counts store listing visitors and installs."
        >
          <div className="grid gap-8 md:grid-cols-2">
            {STORES.map((store) => (
              <StoreFunnel
                key={store.source}
                label={store.label}
                steps={[
                  ...(store.source === 'app_store'
                    ? [{ key: 'impressions', label: 'Impressions', value: fromStore(impressions, store.source), swatch: 'bg-views/50' }]
                    : []),
                  { key: 'pageViews', label: store.visits, value: fromStore(pageViews, store.source), swatch: 'bg-views' },
                  { key: 'downloads', label: 'Downloads', value: fromStore(downloads, store.source), swatch: 'bg-downloads' },
                ]}
                stepRate={(key, before) => storeRate(key, before, { source: store.source })}
              />
            ))}
          </div>
        </Panel>

        <Panel
          title="Day by day"
          description="Store page views and downloads on one day axis, and the share of page views that ended in a download."
          bodyClassName="pb-3"
        >
          <ChartStack>
            {impressions?.summary != null && (
              <ChartRow label="Impressions" swatch="bg-views/50" summary={`${formatCount(impressions.summary)}, App Store only`}>
                <DailyChart days={data.days} values={impressions.values} label="Impressions" color="color-mix(in oklab, var(--views) 50%, transparent)" />
              </ChartRow>
            )}
            <ChartRow label="Store page views" swatch="bg-views" summary={through(pageViews)}>
              <DailyChart days={data.days} values={pageViews?.values ?? []} label="Store page views" color="var(--views)" />
            </ChartRow>
            <ChartRow label="Downloads" swatch="bg-downloads" summary={through(downloads)}>
              <DailyChart days={data.days} values={downloads?.values ?? []} label="Downloads" color="var(--downloads)" />
            </ChartRow>
            <ChartRow label="Page view to download" swatch="bg-foreground" summary="over the apps and stores that report both">
              <DailyChart days={data.days} values={data.conversion ?? []} label="Page view to download" unit="percent" color="var(--foreground)" kind="line" height={150} />
            </ChartRow>
          </ChartStack>
        </Panel>

        {!app && data.apps.length > 1 && (
          <Panel title="By app" description="Each app's store numbers over the same days. Select a column heading to sort by it." bodyClassName="">
            <AppComparison
              range={range}
              sortBy="downloads"
              rows={data.apps.map((entry) => ({
                app: entry.app,
                values: {
                  impressions: entry.totals.impressions,
                  pageViews: entry.totals.pageViews,
                  downloads: entry.totals.downloads,
                  conversion: pairedRatio([entry], 'downloads', 'pageViews', { bySource: true }),
                },
              }))}
              columns={[
                { key: 'impressions', label: 'Impressions', format: formatCount },
                { key: 'pageViews', label: 'Page views', format: formatCount },
                { key: 'downloads', label: 'Downloads', format: formatCount },
                { key: 'conversion', label: 'Page view to download', format: percent },
              ]}
            />
          </Panel>
        )}
      </PageBody>
    </>
  )
}

/** A total, and the last day it covers when some store has not reported the latest days. */
function through(series: PerformanceSeries | undefined) {
  if (series?.summary == null) return undefined
  return `${formatCount(series.summary)}${series.completeThrough ? `, through ${formatDay(series.completeThrough)}` : ''}`
}

/** One store's funnel: a bar per step, as long as its share of the first step. */
function StoreFunnel(props: {
  label: string
  steps: { key: string; label: string; value: number | null; swatch: string }[]
  /** A step as a share of the one before it, over the apps that report both. */
  stepRate: (key: string, before: string) => number | null
}) {
  const first = props.steps.find((step) => step.value !== null)?.value ?? null
  const reported = props.steps.some((step) => step.value !== null)
  return (
    <section aria-label={`${props.label} funnel`}>
      <h3 className="font-medium">{props.label}</h3>
      {!reported ? (
        <p className="mt-2 text-muted-foreground">Nothing reported in this range.</p>
      ) : (
        <ol className="mt-3 space-y-3">
          {props.steps.map((step, index) => {
            const before = index > 0 ? props.steps[index - 1] : undefined
            const stepShare = before ? props.stepRate(step.key, before.key) : null
            const share = step.value !== null && first ? step.value / first : null
            return (
              <li key={step.label}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="text-muted-foreground">{step.label}</span>
                  <span className="figures font-medium">
                    {step.value === null ? <NoData /> : formatCount(step.value)}
                    {stepShare !== null && <span className="ml-2 font-normal text-muted-foreground">{percent(stepShare)}</span>}
                  </span>
                </div>
                <div className="mt-1.5 h-2 rounded-full bg-muted" aria-hidden="true">
                  <div className={cn('h-full rounded-full', step.swatch)} style={{ width: `${share === null ? 0 : Math.max(1, share * 100)}%` }} />
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}

function NoStore() {
  return (
    <Empty className="border border-dashed bg-card">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Store />
        </EmptyMedia>
        <EmptyTitle>No store numbers in this range</EmptyTitle>
        <EmptyDescription>
          Connect App Store Connect or Google Play, then add the apps you want to track. Downloads appear after
          the first sync; store page views a day or two later.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="flex-row justify-center">
        <Button asChild>
          <Link to="/accounts">Connect accounts</Link>
        </Button>
      </EmptyContent>
    </Empty>
  )
}
