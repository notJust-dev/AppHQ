import { useSuspenseQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { Store } from 'lucide-react'
import { FunnelChart, type FunnelStage } from '@/components/FunnelChart'
import { PageBody } from '@/components/PageHeader'
import { Panel } from '@/components/Panel'
import { SourceLogo } from '@/components/SourceLogo'
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
import { rangeToDates } from '@/lib/range'

export const Route = createFileRoute('/_app/store')({
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
            label="Impression to page view"
            value={storeRate('pageViews', 'impressions', { source: 'app_store' })}
            previous={storeRate('pageViews', 'impressions', { source: 'app_store', period: 'previous' })}
            format={percent}
          />
          <Stat
            label="Page view to download"
            value={storeRate('downloads', 'pageViews')}
            previous={storeRate('downloads', 'pageViews', { period: 'previous' })}
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
                source={store.source}
                label={store.label}
                steps={[
                  // Always a step, so both funnels' rows stay level: Google Play never reports
                  // impressions, and the App Store may have none in a short range.
                  storeImpressions(store.source, fromStore(impressions, store.source)),
                  { key: 'pageViews', label: store.visits, value: fromStore(pageViews, store.source), color: 'var(--views)' },
                  { key: 'downloads', label: 'Downloads', value: fromStore(downloads, store.source), color: 'var(--downloads)' },
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
/** Impressions come before the page, so they take a lighter shade of the views colour. */
const IMPRESSIONS_COLOR = 'color-mix(in oklab, var(--views) 50%, var(--card))'

/** The impressions step of a store's funnel, with why it has no number when it has none. */
function storeImpressions(source: string, value: number | null) {
  const missing =
    source !== 'app_store' ? 'Not reported by Google Play' : value === null ? 'None reported in this range' : undefined
  return { key: 'impressions', label: 'Impressions', value: source === 'app_store' ? value : null, color: IMPRESSIONS_COLOR, missing }
}

/**
 * One store's funnel as a chart: the steps it reported, each with its share of the step before.
 * The share pairs app by app (over the apps that report both steps), so it can differ from
 * dividing the two totals.
 */
function StoreFunnel(props: {
  source: string
  label: string
  /** `missing` says why a step has no number when the store never reports it. */
  steps: { key: string; label: string; value: number | null; color: string; missing?: string }[]
  /** A step as a share of the one before it, over the apps that report both. */
  stepRate: (key: string, before: string) => number | null
}) {
  // A step the store never reports stays in, so the rows line up with the other store's funnel;
  // one it could report but did not this time is left out.
  const steps = props.steps.filter((step) => step.value !== null || step.missing)
  const measured = steps.filter((step) => step.value !== null)
  const stages: FunnelStage[] = steps.map((step, index) => {
    const before = steps[index - 1]
    const share = step.value !== null && before?.value != null ? props.stepRate(step.key, before.key) : null
    return {
      key: step.key,
      label: step.label,
      value: step.value,
      color: step.color,
      rate: step.missing ?? (share === null || !before ? undefined : `${percent(share)} of ${before.label.toLowerCase()}`),
    }
  })

  return (
    <section aria-label={`${props.label} funnel`}>
      <h3 className="mb-3 flex items-center gap-2 font-medium">
        <SourceLogo source={props.source} decorative className="size-4 text-muted-foreground" />
        {props.label}
      </h3>
      {measured.length === 0 ? (
        <p className="text-muted-foreground">Nothing reported in this range.</p>
      ) : measured.length === 1 ? (
        <p className="text-muted-foreground">
          Only {measured[0]!.label.toLowerCase()} reported in this range ({formatCount(measured[0]!.value!)}), so there is
          no funnel to draw yet.
        </p>
      ) : (
        <FunnelChart stages={stages} ariaLabel={`${props.label} funnel shape`} />
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
