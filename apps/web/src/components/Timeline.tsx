import { useState, type KeyboardEvent, type PointerEvent } from 'react'
import { formatDay, formatTick, formatValue } from '../lib/format'
import type { Timeline as TimelineData } from '../lib/queries'
import { niceScale, tickIndexes } from '../lib/scale'
import { sourceLabel } from '../lib/sources'

type Series = TimelineData['series'][number]
type Values = Series['values']

/**
 * One app's funnel, one row per step on a shared date axis. Each row has its own scale (the
 * steps are counted in different units and differ by orders of magnitude), and one crosshair
 * reads the same day across every row, which is how a spike in views is compared with what
 * downloads and revenue did around it.
 */

const STAGE = {
  views: { stroke: 'var(--color-views)', swatch: 'bg-views' },
  downloads: { stroke: 'var(--color-downloads)', swatch: 'bg-downloads' },
  revenue: { stroke: 'var(--color-revenue)', swatch: 'bg-revenue' },
} as const

/** Where each row's numbers come from, for a row whose sources have sent nothing at all. */
const WHERE_FROM: Record<string, string> = {
  socialViews: 'Comes from TikTok and Instagram, which are not connected yet.',
  pageViews: 'Comes from App Store and Google Play analytics, which are not connected yet.',
  downloads: 'Connect App Store Connect in Settings.',
  trials: 'Connect RevenueCat in Settings.',
  revenue: 'Connect RevenueCat in Settings.',
  mrr: 'Connect RevenueCat in Settings.',
}

/**
 * Why a row is empty. If one of its sources reported other rows for this app, the source is
 * connected and simply had nothing for this one in the range; otherwise it is not connected.
 */
function emptyReason(
  series: Series,
  reporting: ReadonlySet<string>,
  connected: ReadonlySet<string>,
): string {
  // `from` can be missing for a moment during a deploy, when the dashboard is newer than the API.
  const from = series.from ?? []
  const reported = from.filter((source) => reporting.has(source))
  if (reported.length > 0) return `${reported.map(sourceLabel).join(' and ')} reported none in this range.`
  const linked = from.filter((source) => connected.has(source))
  if (linked.includes('tiktok')) {
    return 'TikTok is connected. Daily views start the day after connecting, once there are two readings to compare.'
  }
  if (linked.length > 0) return `${linked.map(sourceLabel).join(' and ')} connected, with nothing reported in this range yet.`
  return WHERE_FROM[series.key] ?? 'Not connected yet.'
}

// The plot is drawn in a fixed coordinate space and stretched to fit, with strokes that do not
// scale; text and dots are HTML positioned in percent, so nothing is distorted.
const VIEW_W = 1000
const VIEW_H = 100

/** Plot margins, shared by every row and the date axis so the days line up. The left one holds the y-axis labels. */
const PLOT_INSET = 'mr-6 ml-16'

const lastIndexOf = (values: Values) => values.findLastIndex((value) => value !== null)

export function Timeline({
  days,
  series,
  connected = new Set(),
}: {
  days: string[]
  series: Series[]
  /** Providers with an account connected to this app, so an empty row can say why it is empty. */
  connected?: ReadonlySet<string>
}) {
  const [active, setActive] = useState<number | null>(null)
  const [showTable, setShowTable] = useState(false)
  const count = days.length
  const percent = (index: number) => (count <= 1 ? 50 : (index / (count - 1)) * 100)

  const pointAt = (event: PointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const ratio = (event.clientX - rect.left) / rect.width
    setActive(Math.min(count - 1, Math.max(0, Math.round(ratio * (count - 1)))))
  }

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const last = count - 1
    const current = active ?? last
    const next =
      event.key === 'ArrowLeft'
        ? Math.max(0, current - 1)
        : event.key === 'ArrowRight'
          ? Math.min(last, current + 1)
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : undefined
    if (event.key === 'Escape') setActive(null)
    if (next === undefined) return
    event.preventDefault()
    setActive(next)
  }

  const withData = series.filter((entry) => entry.sources.length > 0)
  const reporting = new Set(withData.flatMap((entry) => entry.sources.map((part) => part.source)))
  const readout =
    active === null
      ? ''
      : `${formatDay(days[active] ?? '')}. ${withData
          .map((entry) => {
            const value = entry.values[active]
            return `${entry.label}: ${value === null || value === undefined ? 'no data' : formatValue(value, entry.unit)}`
          })
          .join('. ')}.`

  return (
    <figure>
      <div
        role="group"
        tabIndex={0}
        aria-label="Daily funnel. Use the left and right arrow keys to read one day across every row."
        onKeyDown={onKeyDown}
        onFocus={() => setActive((current) => current ?? count - 1)}
        onBlur={() => setActive(null)}
        onPointerLeave={() => setActive(null)}
        className="overflow-hidden rounded-lg border border-line bg-surface outline-offset-4"
      >
        {series.map((entry) => (
          <Track
            key={entry.key}
            series={entry}
            days={days}
            active={active}
            percent={percent}
            onPoint={pointAt}
            reporting={reporting}
            connected={connected}
          />
        ))}
        <DateAxis days={days} percent={percent} />
      </div>

      <div aria-live="polite" className="sr-only">
        {readout}
      </div>

      <figcaption className="mt-3 flex flex-wrap items-baseline justify-between gap-3 text-sm text-ink-soft">
        <span>
          Each row has its own scale. Point at a day, or focus the chart and use the arrow keys,
          to read that day across every row.
        </span>
        <button
          type="button"
          onClick={() => setShowTable((shown) => !shown)}
          aria-expanded={showTable}
          className="cursor-pointer font-medium text-ink underline underline-offset-4"
        >
          {showTable ? 'Hide the numbers' : 'Show the numbers as a table'}
        </button>
      </figcaption>

      {showTable && <TimelineTable days={days} series={withData} />}
    </figure>
  )
}

function Track(props: {
  series: Series
  days: string[]
  active: number | null
  percent: (index: number) => number
  onPoint: (event: PointerEvent<HTMLElement>) => void
  /** Sources that reported anything for this app in the range. */
  reporting: ReadonlySet<string>
  connected: ReadonlySet<string>
}) {
  const { series, days, active, percent } = props
  const stage = STAGE[series.stage]
  const empty = series.sources.length === 0

  const present = series.values.filter((value): value is number => value !== null)
  const scale = niceScale(Math.max(0, ...present), { integer: series.unit === 'count' })
  const low = Math.min(0, ...present)
  const y = (value: number) => VIEW_H - ((value - low) / (scale.max - low)) * VIEW_H
  const yPercent = (value: number) => (y(value) / VIEW_H) * 100

  const lastIndex = lastIndexOf(series.values)
  const shownIndex = active ?? (lastIndex >= 0 ? lastIndex : null)
  const shownValue = shownIndex === null ? null : (series.values[shownIndex] ?? null)
  const headline = active === null ? series.summary : (series.values[active] ?? null)

  const caption =
    active !== null
      ? `${formatDay(days[active] ?? '')}${series.values[active] === null ? ', no data' : ''}`
      : series.aggregate === 'last' && lastIndex >= 0
        ? `Latest, ${formatDay(days[lastIndex] ?? '')}`
        : `Total over ${days.length} days`

  return (
    <div className="border-b border-line md:grid md:grid-cols-[13rem_1fr]">
      <div className="px-6 pt-4 md:py-4">
        <p className="flex items-center gap-2 text-sm font-medium">
          <span className={`size-2.5 rounded-[3px] ${stage.swatch}`} aria-hidden="true" />
          {series.label}
        </p>
        {empty ? (
          <p className="mt-1 text-sm text-ink-soft">No data yet</p>
        ) : (
          <>
            <p className="figures mt-1 font-display text-2xl font-semibold tracking-tight">
              {headline === null ? '–' : formatValue(headline, series.unit)}
            </p>
            <p className="text-xs text-ink-soft">{caption}</p>
            {series.sources.length > 1 && (
              <dl className="mt-2 grid grid-cols-[auto_auto] justify-start gap-x-4 text-xs">
                {series.sources.map((source) => {
                  const value = active === null ? source.summary : source.values[active]
                  return (
                    <div key={source.source} className="contents">
                      <dt className="text-ink-soft">{sourceLabel(source.source)}</dt>
                      <dd className="figures text-right">
                        {value === null || value === undefined ? '–' : formatValue(value, series.unit)}
                      </dd>
                    </div>
                  )
                })}
              </dl>
            )}
          </>
        )}
      </div>

      {empty ? (
        <p className="px-6 pt-1 pb-4 text-sm text-ink-soft md:self-center md:py-4">
          {emptyReason(series, props.reporting, props.connected)}
        </p>
      ) : (
        <div
          onPointerMove={props.onPoint}
          onPointerDown={props.onPoint}
          className={`relative mt-5 mb-4 h-20 touch-pan-y md:mt-6 ${PLOT_INSET}`}
        >
          <svg
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            preserveAspectRatio="none"
            className="absolute inset-0 size-full overflow-visible"
            aria-hidden="true"
          >
            {scale.ticks.map((tick) => (
              <line
                key={tick}
                x1={0}
                x2={VIEW_W}
                y1={y(tick)}
                y2={y(tick)}
                stroke="var(--color-line)"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            <path d={areaPath(series.values, y(0), y, days.length)} fill={stage.stroke} fillOpacity={0.1} />
            <path
              d={linePath(series.values, y, days.length)}
              fill="none"
              stroke={stage.stroke}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>

          {scale.ticks.map((tick) => (
            <span
              key={tick}
              className="figures pointer-events-none absolute right-full mr-2 -translate-y-1/2 text-[11px] leading-none whitespace-nowrap text-ink-soft"
              style={{ top: `${yPercent(tick)}%` }}
            >
              {formatTick(tick, series.unit)}
            </span>
          ))}

          {active !== null && (
            <span
              className="pointer-events-none absolute inset-y-0 w-px bg-ink/40"
              style={{ left: `${percent(active)}%` }}
              aria-hidden="true"
            />
          )}

          {shownIndex !== null && shownValue !== null && (
            <span
              className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface"
              style={{
                left: `${percent(shownIndex)}%`,
                top: `${yPercent(shownValue)}%`,
                backgroundColor: stage.stroke,
              }}
              aria-hidden="true"
            />
          )}
        </div>
      )}
    </div>
  )
}

function DateAxis({ days, percent }: { days: string[]; percent: (index: number) => number }) {
  const indexes = tickIndexes(days.length)
  const last = days.length - 1
  return (
    <div className="md:grid md:grid-cols-[13rem_1fr]" aria-hidden="true">
      <div className="hidden md:block" />
      <div className={`relative h-9 ${PLOT_INSET}`}>
        {indexes.map((index) => (
          <span
            key={index}
            className={`figures absolute top-2.5 text-xs whitespace-nowrap text-ink-soft ${
              index === 0 ? '' : index === last ? '-translate-x-full' : '-translate-x-1/2'
            }`}
            style={{ left: `${percent(index)}%` }}
          >
            {formatDay(days[index] ?? '')}
          </span>
        ))}
      </div>
    </div>
  )
}

function TimelineTable({ days, series }: { days: string[]; series: Series[] }) {
  // Newest first: the recent days are the ones people look up.
  const order = days.map((_, index) => index).reverse()
  return (
    <div className="mt-4 max-h-[28rem] overflow-auto rounded-lg border border-line bg-surface">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <caption className="sr-only">Daily values for every funnel step</caption>
        <thead className="sticky top-0 bg-surface">
          <tr className="border-b border-line text-ink-soft">
            <th scope="col" className="px-6 py-3 text-left font-medium">
              Day
            </th>
            {series.map((entry) => (
              <th key={entry.key} scope="col" className="px-6 py-3 text-right font-medium">
                {entry.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {order.map((index) => (
            <tr key={days[index]} className="border-b border-line last:border-b-0">
              <th scope="row" className="px-6 py-2 text-left font-normal whitespace-nowrap">
                {formatDay(days[index] ?? '')}
              </th>
              {series.map((entry) => {
                const value = entry.values[index]
                return (
                  <td key={entry.key} className="figures px-6 py-2 text-right">
                    {value === null || value === undefined ? '–' : formatValue(value, entry.unit)}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Runs of consecutive days that have a value, as [index, value] pairs. */
function runs(values: Values): [number, number][][] {
  const result: [number, number][][] = []
  let current: [number, number][] = []
  values.forEach((value, index) => {
    if (value === null) {
      if (current.length > 0) result.push(current)
      current = []
    } else {
      current.push([index, value])
    }
  })
  if (current.length > 0) result.push(current)
  return result
}

const xAt = (index: number, count: number) => (count <= 1 ? VIEW_W / 2 : (index / (count - 1)) * VIEW_W)

function linePath(values: Values, y: (value: number) => number, count: number): string {
  return runs(values)
    .map((run) => {
      const [first, ...rest] = run
      if (!first) return ''
      const start = `M${xAt(first[0], count)},${y(first[1])}`
      // A lone day still gets a visible mark: a zero-length segment with a round cap.
      if (rest.length === 0) return `${start}h0.01`
      return start + rest.map(([index, value]) => `L${xAt(index, count)},${y(value)}`).join('')
    })
    .join('')
}

function areaPath(values: Values, base: number, y: (value: number) => number, count: number): string {
  return runs(values)
    .filter((run) => run.length > 1)
    .map((run) => {
      const first = run[0]
      const last = run[run.length - 1]
      if (!first || !last) return ''
      const top = run.map(([index, value]) => `L${xAt(index, count)},${y(value)}`).join('')
      return `M${xAt(first[0], count)},${base}${top}L${xAt(last[0], count)},${base}Z`
    })
    .join('')
}
