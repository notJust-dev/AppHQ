import { useSuspenseQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { Wallet } from 'lucide-react'
import { PageBody } from '@/components/PageHeader'
import { Panel } from '@/components/Panel'
import { AppComparison } from '@/components/performance/AppComparison'
import { ChartRow, ChartStack } from '@/components/performance/ChartStack'
import { DailyChart } from '@/components/performance/DailyChart'
import { PerformanceHeader } from '@/components/performance/PerformanceHeader'
import { Stat, StatGrid } from '@/components/performance/Stat'
import { Button } from '@/components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { formatCount, formatMoney } from '@/lib/format'
import { pairedRatio } from '@/lib/performance'
import { monetisationPerformanceQuery } from '@/lib/queries'
import { rangeToDates } from '@/lib/range'

export const Route = createFileRoute('/_app/monetisation')({
  loaderDeps: ({ search }) => ({ range: search.range, app: search.app }),
  loader: ({ context, deps }) =>
    context.queryClient.ensureQueryData(monetisationPerformanceQuery({ ...rangeToDates(deps.range), appId: deps.app })),
  component: MonetisationPage,
})


function MonetisationPage() {
  const { range, app } = Route.useSearch()
  const dates = rangeToDates(range)
  const { data } = useSuspenseQuery(monetisationPerformanceQuery({ ...dates, appId: app }))
  const series = (key: string) => data.series.find((entry) => entry.key === key)
  const revenue = series('revenue')
  const mrr = series('mrr')
  const subscriptions = series('activeSubs')
  const activeTrials = series('activeTrials')
  const trials = series('trials')
  const customers = series('newCustomers')

  const header = (
    <PerformanceHeader
      title="Monetisation"
      description="What the apps earn, and the subscriptions and trials behind it, from RevenueCat."
      range={range}

      dates={dates}
    />
  )

  if (revenue?.summary == null && mrr?.summary == null) {
    return (
      <>
        {header}
        <PageBody>
          <NoRevenue />
        </PageBody>
      </>
    )
  }

  return (
    <>
      {header}
      <PageBody>
        <StatGrid>
          <Stat label="Revenue" swatch="bg-revenue" value={revenue?.summary ?? null} previous={revenue?.previous} format={formatMoney} />
          <Stat label="MRR" swatch="bg-revenue" value={mrr?.summary ?? null} previous={mrr?.previous} format={formatMoney} />
          <Stat label="Active subscriptions" value={subscriptions?.summary ?? null} previous={subscriptions?.previous} format={formatCount} />
          <Stat label="Active trials" value={activeTrials?.summary ?? null} previous={activeTrials?.previous} format={formatCount} />
          <Stat label="Trials started" value={trials?.summary ?? null} previous={trials?.previous} format={formatCount} />
          <Stat
            label="Revenue per download"
            value={pairedRatio(data.apps, 'revenue', 'downloads')}
            previous={pairedRatio(data.apps, 'revenue', 'downloads', { period: 'previous' })}
            format={formatMoney}
            hint="Over the apps that report both"
          />
        </StatGrid>

        <Panel title="Revenue" description="Each day's revenue in US dollars, as RevenueCat reports it." bodyClassName="pb-3">
          <ChartStack>
            <ChartRow label="Revenue" swatch="bg-revenue" summary={revenue?.summary != null ? formatMoney(revenue.summary) : undefined}>
              <DailyChart days={data.days} values={revenue?.values ?? []} label="Revenue" unit="usd" color="var(--revenue)" height={220} />
            </ChartRow>
          </ChartStack>
        </Panel>

        <div className="grid gap-6 xl:grid-cols-2">
          <Panel title="Recurring revenue" description="MRR and active subscriptions at the end of each day." bodyClassName="pb-3">
            <ChartStack>
              <ChartRow label="MRR" swatch="bg-revenue" summary={mrr?.summary != null ? `${formatMoney(mrr.summary)} now` : undefined}>
                <DailyChart days={data.days} values={mrr?.values ?? []} label="MRR" unit="usd" color="var(--revenue)" kind="line" height={160} />
              </ChartRow>
              <ChartRow
                label="Active subscriptions"
                swatch="bg-revenue"
                summary={subscriptions?.summary != null ? `${formatCount(subscriptions.summary)} now` : undefined}
              >
                <DailyChart
                  days={data.days}
                  values={subscriptions?.values ?? []}
                  label="Active subscriptions"
                  color="var(--revenue)"
                  kind="line"
                  height={160}
                />
              </ChartRow>
            </ChartStack>
          </Panel>
          <Panel title="New business" description="Trials started and new customers each day." bodyClassName="pb-3">
            <ChartStack>
              <ChartRow label="Trials started" swatch="bg-revenue" summary={trials?.summary != null ? formatCount(trials.summary) : undefined}>
                <DailyChart days={data.days} values={trials?.values ?? []} label="Trials started" color="var(--revenue)" height={160} />
              </ChartRow>
              <ChartRow label="New customers" swatch="bg-revenue" summary={customers?.summary != null ? formatCount(customers.summary) : undefined}>
                <DailyChart days={data.days} values={customers?.values ?? []} label="New customers" color="var(--revenue)" height={160} />
              </ChartRow>
            </ChartStack>
          </Panel>
        </div>

        {!app && data.apps.length > 1 && (
          <Panel title="By app" description="Each app's money over the same days. Select a column heading to sort by it." bodyClassName="">
            <AppComparison
              sortBy="revenue"
              rows={data.apps.map((entry) => ({
                app: entry.app,
                values: {
                  revenue: entry.totals.revenue,
                  mrr: entry.totals.mrr,
                  activeSubs: entry.totals.activeSubs,
                  trials: entry.totals.trials,
                  perDownload: pairedRatio([entry], 'revenue', 'downloads'),
                },
              }))}
              columns={[
                { key: 'revenue', label: 'Revenue', format: formatMoney },
                { key: 'mrr', label: 'MRR', format: formatMoney },
                { key: 'activeSubs', label: 'Active subscriptions', format: formatCount },
                { key: 'trials', label: 'Trials started', format: formatCount },
                { key: 'perDownload', label: 'Revenue per download', format: formatMoney },
              ]}
            />
          </Panel>
        )}
      </PageBody>
    </>
  )
}

function NoRevenue() {
  return (
    <Empty className="border border-dashed bg-card">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Wallet />
        </EmptyMedia>
        <EmptyTitle>No revenue numbers in this range</EmptyTitle>
        <EmptyDescription>
          Revenue comes from RevenueCat. Open an app's Settings and paste a secret key from its RevenueCat
          project; about a year of history is fetched.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="flex-row justify-center">
        <Button asChild>
          <Link to="/apps">Go to the apps</Link>
        </Button>
      </EmptyContent>
    </Empty>
  )
}
