import { barY, defineChart, lineY, ruleY } from '@tanstack/charts'
import { Chart } from '@tanstack/charts/react'
import { scaleBand } from '@tanstack/charts/scales/band'
import { scaleLinear } from '@tanstack/charts/scales/linear'
import { tooltip } from '@tanstack/charts/tooltip'
import { useMemo } from 'react'
import { formatDay } from '@/lib/format'

export type ChartUnit = 'count' | 'usd' | 'percent' | 'ratio'

const whole = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })
const cents = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const oneDecimal = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 })

/** A value in a tooltip: in full. */
export function formatUnit(value: number, unit: ChartUnit) {
  switch (unit) {
    case 'usd':
      return Math.abs(value) < 100 ? cents.format(value) : `$${whole.format(value)}`
    case 'percent':
      return `${oneDecimal.format(value * 100)}%`
    case 'ratio':
      return oneDecimal.format(value)
    default:
      return whole.format(value)
  }
}

/** A tick on the value axis: compact, so every chart's axis fits the same width. */
function formatAxis(value: number, unit: ChartUnit) {
  if (unit === 'percent') return `${whole.format(value * 100)}%`
  const text = Math.abs(value) < 1000 ? oneDecimal.format(value) : compact.format(value)
  return unit === 'usd' ? `$${text}` : text
}

/**
 * The value axis is this wide on every daily chart, so charts stacked on one page line their
 * days up, like small multiples of one figure.
 */
const AXIS_WIDTH = 52

/**
 * One daily series as bars (flows such as views or downloads) or a line (levels and rates such
 * as MRR or a conversion). The day axis always spans `days`, so a series that starts late or
 * has gaps still lines up with the charts above and below it.
 */
export function DailyChart(props: {
  days: string[]
  values: (number | null)[]
  /** What one value is, for the tooltip and screen readers, e.g. "Downloads". */
  label: string
  unit?: ChartUnit
  /** Any CSS colour, usually a stage token such as `var(--views)`. */
  color: string
  kind?: 'bar' | 'line'
  height?: number
}) {
  const { days, values, label, color } = props
  const unit = props.unit ?? 'count'
  const kind = props.kind ?? 'bar'

  const rows = useMemo(() => days.map((day, index) => ({ day, value: values[index] ?? null })), [days, values])

  // About eight evenly spaced dates, ending on the latest day.
  const tickDays = useMemo(() => {
    const step = Math.max(1, Math.ceil(days.length / 8))
    return days.filter((_, index) => (days.length - 1 - index) % step === 0)
  }, [days])

  const definition = useMemo(() => {
    const present = rows.filter((row): row is { day: string; value: number } => row.value !== null)
    const mark =
      kind === 'bar'
        ? barY(present, { x: 'day', y: 'value', fill: color, radius: { end: 2 } })
        : lineY(rows, { x: 'day', y: 'value', stroke: color, strokeWidth: 2 })
    return defineChart({
      marks: [mark, ruleY([0])],
      margin: { left: AXIS_WIDTH },
      scales: {
        x: {
          scale: scaleBand<string>()
            .domain(days)
            .padding(kind === 'bar' ? 0.25 : 1),
          axis: { ticks: { values: tickDays, format: formatDay } },
        },
        y: {
          scale: scaleLinear,
          nice: true,
          grid: true,
          axis: { ticks: { format: (value: number) => formatAxis(value, unit) } },
        },
      },
      focus: 'group-x',
      tooltip: {
        use: tooltip,
        content: (points) => {
          const point = points[0]
          return {
            title: formatDay(point?.datum.day ?? ''),
            rows: point && point.datum.value !== null ? [{ label, value: formatUnit(point.datum.value, unit), color }] : [],
          }
        },
      },
    })
  }, [rows, days, tickDays, kind, color, label, unit])

  return <Chart definition={definition} height={props.height ?? 180} initialWidth={1000} ariaLabel={`Daily ${label.toLowerCase()}`} />
}
