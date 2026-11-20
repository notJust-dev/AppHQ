import { toIsoDate, type IsoDate } from '../../lib/dates.js'
import type { RevenueCatChart } from './client.js'

export interface DailyPoint {
  date: IsoDate
  value: number
  /** True for a period RevenueCat has not finished computing, typically today. */
  incomplete: boolean
}

export interface DailySeries {
  /** The measure that was read, or null when the chart did not describe its measures. */
  measure: string | null
  /** Set when the wanted measure was not found by name and the first one was used instead. */
  fallback: boolean
  points: DailyPoint[]
}

/**
 * Picks one measure out of a chart and returns it as one value per UTC day.
 *
 * A chart can carry several measures (the revenue chart has Revenue and Transactions, for
 * example), so the measure is chosen by name. If no name matches, the first measure is used,
 * which RevenueCat treats as the chart's primary one, and `fallback` is set so the caller can
 * say so in the log.
 */
export function toDailySeries(chart: RevenueCatChart, wanted: RegExp): DailySeries {
  const measures = chart.measures ?? []
  const byName = measures.findIndex((measure) => wanted.test(measure.display_name))
  const index = byName === -1 ? 0 : byName

  const points = chart.values
    // Segmented responses repeat every period per segment; this connector never asks for one.
    .filter((point) => (point.measure ?? 0) === index && point.segment === undefined)
    .flatMap((point) =>
      point.value === null
        ? []
        : [
            {
              date: toIsoDate(new Date(point.cohort * 1000)),
              value: point.value,
              incomplete: point.incomplete === true,
            },
          ],
    )

  return {
    measure: measures[index]?.display_name ?? null,
    fallback: byName === -1 && measures.length > 1,
    points,
  }
}
