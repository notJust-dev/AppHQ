import { and, eq, gte, inArray, lte } from 'drizzle-orm'
import { z } from 'zod'
import { apps, metricDaily } from '../db/schema.js'
import { eachDay, type IsoDate } from '../lib/dates.js'
import { TIMELINE } from '../metrics/catalog.js'
import { defineQuery } from './define.js'
import { checkRange, rangeFields } from './range.js'

type Definition = (typeof TIMELINE)[number]
type Values = (number | null)[]

export interface MetricRow {
  date: IsoDate
  source: string
  metric: string
  value: number
}

const toCents = (amount: number) => Math.round(amount * 100) / 100

function summarize(aggregate: Definition['aggregate'], values: Values): number | null {
  const present = values.filter((value): value is number => value !== null)
  if (present.length === 0) return null
  return aggregate === 'last' ? (present.at(-1) ?? null) : present.reduce((a, b) => a + b, 0)
}

/**
 * Turns metric rows into one series per timeline row, with one value per day. A day no source
 * reported is null, not zero, so a source that has not caught up yet shows as a gap instead of
 * a collapse. Each series also carries its per-source parts.
 */
export function buildTimeline(rows: MetricRow[], days: IsoDate[]) {
  const dayIndex = new Map(days.map((day, index) => [day, index]))

  return TIMELINE.map((definition) => {
    const round = (value: number) => (definition.unit === 'usd' ? toCents(value) : value)
    const bySource = new Map<string, Values>()

    for (const row of rows) {
      if (row.metric !== definition.metric) continue
      if (!(definition.sources as readonly string[]).includes(row.source)) continue
      const index = dayIndex.get(row.date)
      if (index === undefined) continue
      const values = bySource.get(row.source) ?? days.map(() => null)
      values[index] = (values[index] ?? 0) + row.value
      bySource.set(row.source, values)
    }

    const sources = definition.sources.flatMap((source) => {
      const values = bySource.get(source)
      if (!values) return []
      const rounded = values.map((value) => (value === null ? null : round(value)))
      const summary = summarize(definition.aggregate, rounded)
      return [{ source, values: rounded, summary }]
    })

    const values: Values = days.map((_, index) => {
      let total: number | null = null
      for (const { values: sourceValues } of sources) {
        const value = sourceValues[index]
        if (value !== null && value !== undefined) total = (total ?? 0) + value
      }
      return total === null ? null : round(total)
    })

    const summary = summarize(definition.aggregate, values)
    return {
      key: definition.key,
      label: definition.label,
      stage: definition.stage,
      unit: definition.unit,
      aggregate: definition.aggregate,
      /** Every source that can report this row, whether or not it has. */
      from: [...definition.sources],
      values,
      summary: summary === null ? null : round(summary),
      sources,
    }
  })
}

export const getAppTimeline = defineQuery({
  name: 'get_app_timeline',
  description:
    "One app's funnel as daily series on a shared date axis: social views, store page views, " +
    'downloads, trials started, revenue (USD) and MRR. Each series has one value per day, null ' +
    'where no source reported that day, plus a summary (the total over the range, or for MRR ' +
    'the latest value) and the same broken down by source. Returns null for an unknown app.',
  input: z
    .object({ appId: z.string().min(1).max(64).describe('The app id from list_apps.'), ...rangeFields })
    .superRefine(checkRange),
  async handler({ db }, input) {
    const [app] = await db
      .select({ id: apps.id, name: apps.name })
      .from(apps)
      .where(eq(apps.id, input.appId))
      .limit(1)
    if (!app) return null

    const rows = await db
      .select({
        date: metricDaily.date,
        source: metricDaily.source,
        metric: metricDaily.metric,
        value: metricDaily.value,
      })
      .from(metricDaily)
      .where(
        and(
          eq(metricDaily.appId, app.id),
          gte(metricDaily.date, input.from),
          lte(metricDaily.date, input.to),
          eq(metricDaily.dimension, ''),
          inArray(
            metricDaily.metric,
            TIMELINE.map((definition) => definition.metric),
          ),
        ),
      )

    const days = eachDay({ from: input.from, to: input.to })
    return {
      app,
      range: { from: input.from, to: input.to },
      days,
      series: buildTimeline(rows, days),
    }
  },
})
