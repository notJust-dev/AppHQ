import { barY, colorLegend, colorLegendItems, defineChart, ruleY, stack } from '@tanstack/charts'
import { Chart } from '@tanstack/charts/react'
import { scaleBand } from '@tanstack/charts/scales/band'
import { scaleLinear } from '@tanstack/charts/scales/linear'
import { tooltip } from '@tanstack/charts/tooltip'
import { useMemo } from 'react'
import { formatCount, formatDay } from '@/lib/format'
import type { Timeline } from '@/lib/queries'
import { Panel } from '@/components/Panel'

/** The stores, in stack order from the baseline up; the order also fixes their colours. */
const STORES = [
  { source: 'app_store', label: 'App Store' },
  { source: 'google_play', label: 'Google Play' },
] as const

type StoreLabel = (typeof STORES)[number]['label']

interface StoreDay {
  day: string
  store: StoreLabel
  downloads: number
}

/**
 * Each day's downloads split by store, as stacked bars. Days after the last one every store has
 * reported are left out, as in the timeline's totals: Google Play posts days later, and a bar
 * without it would look like a drop.
 */
export function DownloadsByStore({ timeline }: { timeline: Timeline }) {
  const downloads = timeline.series.find((series) => series.key === 'downloads')
  const through = downloads?.completeThrough ?? null

  const rows = useMemo(() => {
    const result: StoreDay[] = []
    if (!downloads) return result
    timeline.days.forEach((day, index) => {
      if (through !== null && day > through) return
      for (const store of STORES) {
        const value = downloads.sources.find((part) => part.source === store.source)?.values[index]
        if (value !== null && value !== undefined) result.push({ day, store: store.label, downloads: value })
      }
    })
    return result
  }, [downloads, timeline.days, through])

  // About eight evenly spaced dates, ending on the latest day shown.
  const tickDays = useMemo(() => {
    const days = [...new Set(rows.map((row) => row.day))]
    const step = Math.max(1, Math.ceil(days.length / 8))
    return days.filter((_, index) => (days.length - 1 - index) % step === 0)
  }, [rows])

  const definition = useMemo(
    () =>
      defineChart({
        marks: [
          barY(rows, {
            x: 'day',
            y: 'downloads',
            color: 'store',
            layout: stack({ order: STORES.map((store) => store.label) }),
            // A hairline of the panel colour between stacked segments keeps them apart. With
            // more than a month of days the bars are too thin for it; the two greens, checked
            // against each other, still tell the stores apart.
            ...(tickDays.length > 0 && new Set(rows.map((row) => row.day)).size <= 31
              ? { stroke: 'var(--card)', strokeWidth: 1 }
              : {}),
            radius: { end: 2 },
          }),
          ruleY([0]),
        ],
        scales: {
          x: {
            scale: () => scaleBand<string>().padding(0.25),
            axis: { ticks: { values: tickDays, format: formatDay } },
          },
          y: {
            scale: scaleLinear,
            nice: true,
            grid: true,
            axis: { ticks: { format: formatCount } },
          },
        },
        color: {
          domain: STORES.map((store) => store.label),
          legend: colorLegend({
            items: colorLegendItems<StoreLabel>({
              justify: 'start',
              gap: 20,
              indicator: { shape: 'square', width: 10, height: 10, gap: 6 },
              label: { fontSize: 12, fill: 'currentColor' },
            }),
          }),
        },
        focus: 'group-x',
        tooltip: {
          use: tooltip,
          content: (points) => {
            const total = points.reduce((sum, point) => sum + point.datum.downloads, 0)
            return {
              title: formatDay(points[0]?.datum.day ?? ''),
              rows: [
                ...points.map((point) => ({
                  label: point.datum.store,
                  value: formatCount(point.datum.downloads),
                  color: point.color,
                })),
                ...(points.length > 1 ? [{ label: 'Total', value: formatCount(total) }] : []),
              ],
            }
          },
        },
      }),
    [rows, tickDays],
  )

  if (rows.length === 0) return null

  const totals = STORES.map((store) => ({
    ...store,
    total: rows.filter((row) => row.store === store.label).reduce((sum, row) => sum + row.downloads, 0),
    reported: rows.some((row) => row.store === store.label),
  }))
  const reporting = totals.filter((store) => store.reported)

  return (
    <Panel
      title="Downloads by store"
      description={
        reporting.length > 1
          ? `${totals.map((store) => `${formatCount(store.total)} from ${store.label === 'App Store' ? 'the App Store' : 'Google Play'}`).join(', ')}${through ? `, through ${formatDay(through)}; Google Play reports days later` : ''}.`
          : `Only ${reporting[0]?.label === 'App Store' ? 'the App Store' : 'Google Play'} reports downloads for this app.`
      }
    >
      <Chart
        definition={definition}
        height={260}
        initialWidth={1000}
        className="store-chart"
        ariaLabel="Daily downloads by store"
      />
    </Panel>
  )
}
