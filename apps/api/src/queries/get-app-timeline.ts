import { and, eq, gte, inArray, lte } from 'drizzle-orm'
import { z } from 'zod'
import { apps, metricDaily } from '../db/schema.js'
import { eachDay, type IsoDate } from '../lib/dates.js'
import { TIMELINE } from '../metrics/catalog.js'
import { lastCompleteDay } from '../metrics/complete.js'
import { defineQuery } from './define.js'
import { checkRange, rangeFields } from './range.js'
import { tiktokDailyFrom } from './tiktok-history.js'

type Values = (number | null)[]

/** A daily series: one metric summed over the sources that report it. */
export interface SeriesDefinition {
  key: string
  label: string
  metric: string
  sources: readonly string[]
  unit: 'count' | 'usd'
  /** How a range is summed up: a total for flows, the latest value for levels such as MRR. */
  aggregate: 'sum' | 'last'
}

export interface MetricRow {
  date: IsoDate
  source: string
  metric: string
  value: number
}

const toCents = (amount: number) => Math.round(amount * 100) / 100

function summarize(aggregate: SeriesDefinition['aggregate'], values: Values): number | null {
  const present = values.filter((value): value is number => value !== null)
  if (present.length === 0) return null
  return aggregate === 'last' ? (present.at(-1) ?? null) : present.reduce((a, b) => a + b, 0)
}

/** The app timeline's rows, each with the funnel stage that colours it. */
export function buildTimeline(rows: MetricRow[], days: IsoDate[]) {
  return buildSeries(TIMELINE, rows, days).map((series, index) => ({
    ...series,
    stage: TIMELINE[index]!.stage,
  }))
}

/**
 * Turns metric rows into one series per definition, with one value per day. A day no source
 * reported is null, not zero, so a source that has not caught up yet shows as a gap instead of
 * a collapse. Each series also carries its per-source parts.
 */
export function buildSeries<D extends SeriesDefinition>(definitions: readonly D[], rows: MetricRow[], days: IsoDate[]) {
  const dayIndex = new Map(days.map((day, index) => [day, index]))

  return definitions.map((definition) => {
    const round = (value: number) => (definition.unit === 'usd' ? toCents(value) : value)
    const bySource = new Map<string, Values>()

    for (const row of rows) {
      if (row.metric !== definition.metric) continue
      if (!definition.sources.includes(row.source)) continue
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

    // A total stops at the last day every source still reporting has reached, so a store that
    // reports later does not show up as a drop. Its sources' own values carry on.
    const lastDays = new Map<string, IsoDate>()
    for (const { source, values: sourceValues } of sources) {
      const last = sourceValues.findLastIndex((value) => value !== null)
      const day = days[last]
      if (last >= 0 && day) lastDays.set(source, day)
    }
    const complete = lastCompleteDay(lastDays)
    const late = complete.waitingFor.length > 0 ? complete.through : null

    const sumAt = (index: number) => {
      let total: number | null = null
      for (const { values: sourceValues } of sources) {
        const value = sourceValues[index]
        if (value !== null && value !== undefined) total = (total ?? 0) + value
      }
      return total === null ? null : round(total)
    }
    const values: Values = days.map((day, index) => (late !== null && day > late ? null : sumAt(index)))
    // The days after `late`, summed over the sources that have reported them. It starts on
    // `late` itself so a chart can draw it on from where the complete total ends.
    const partial: Values = days.map((day, index) => (late !== null && day >= late ? sumAt(index) : null))

    const summary = summarize(definition.aggregate, values)
    // The per-source summaries cover the same days as the total, so they add up to it; the
    // daily values still show each source as far as it has reported.
    const sourcesSummed =
      late === null
        ? sources
        : sources.map((part) => ({
            ...part,
            summary: summarize(
              definition.aggregate,
              part.values.map((value, index) => ((days[index] ?? '') > late ? null : value)),
            ),
          }))
    return {
      key: definition.key,
      label: definition.label,
      unit: definition.unit,
      aggregate: definition.aggregate,
      /** Every source that can report this row, whether or not it has. */
      from: [...definition.sources],
      values,
      summary: summary === null ? null : round(summary),
      sources: sourcesSummed,
      /** Set when the total ends early because some sources report later than others. */
      completeThrough: late,
      /** The sources the days after `completeThrough` are waiting for. */
      waitingFor: late === null ? [] : complete.waitingFor,
      /**
       * From `completeThrough` on, what the sources that have reported so far add up to; null
       * on every other day, and on every day when nothing is late. Not a total: it is missing
       * the sources in `waitingFor`.
       */
      partial,
    }
  })
}

export const getAppTimeline = defineQuery({
  name: 'get_app_timeline',
  description:
    "One app's funnel as daily series on a shared date axis: social views, store page views, " +
    'downloads, trials started, revenue (USD) and MRR. Each series has one value per day, null ' +
    'where no source reported that day, plus a summary (the total over the range, or for MRR ' +
    'the latest value) and the same broken down by source. Sources report with different ' +
    'delays (Google Play up to a week), so a total stops at `completeThrough` when some sources ' +
    '(`waitingFor`) have not reached the latest days; per-source values go on, and `partial` ' +
    'sums the sources that have reported those days so far. Returns null for ' +
    'an unknown app.',
  input: z
    .object({ appId: z.uuid().describe('The app id from list_apps.'), ...rangeFields })
    .superRefine(checkRange),
  async handler(scope, input) {
    return scope.run(async (db) => {
      const { organizationId } = scope
      const [app] = await db
        .select({ id: apps.id, name: apps.name })
        .from(apps)
        .where(and(eq(apps.organizationId, organizationId), eq(apps.id, input.appId)))
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
            eq(metricDaily.organizationId, organizationId),
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
        /** The first day TikTok views are daily; before it they sit on each video's post day. */
        tiktokDailyFrom: await tiktokDailyFrom(scope, app.id),
      }
    })
  },
})
