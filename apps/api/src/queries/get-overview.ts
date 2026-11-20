import { and, asc, eq, gte, inArray, lte, min, sql } from 'drizzle-orm'
import { z } from 'zod'
import { apps, metricDaily } from '../db/schema.js'
import { eachDay, previousPeriod, rangeLength, type DateRange } from '../lib/dates.js'
import { HEADLINE, type HeadlineKey } from '../metrics/catalog.js'
import { defineQuery } from './define.js'

export type HeadlineTotals = Record<HeadlineKey, number>

const MAX_RANGE_DAYS = 366

export const overviewInput = z
  .object({
    from: z.iso.date().describe('First day, inclusive, as YYYY-MM-DD (UTC).'),
    to: z.iso.date().describe('Last day, inclusive, as YYYY-MM-DD (UTC).'),
  })
  .refine((r) => r.from <= r.to, { message: '`from` must not be after `to`' })
  .refine((r) => rangeLength(r) <= MAX_RANGE_DAYS, {
    message: `range must be at most ${MAX_RANGE_DAYS} days`,
  })

const zeroTotals = (): HeadlineTotals => ({ downloads: 0, revenue: 0, socialViews: 0 })

/** Sums of floats drift (32233.989999999998); money leaves the API rounded to the cent. */
const toCents = (amount: number) => Math.round(amount * 100) / 100

/** Sum of one headline metric across the sources that report it, as a SQL aggregate. */
const headlineSum = (key: HeadlineKey) => {
  const { metric, sources } = HEADLINE[key]
  return sql<number>`coalesce(sum(${metricDaily.value}) filter (
    where ${metricDaily.metric} = ${metric} and ${inArray(metricDaily.source, [...sources])}
  ), 0)`.mapWith(Number)
}

export const getOverview = defineQuery({
  name: 'get_overview',
  description:
    'Portfolio overview for a date range: per-app totals for downloads, revenue (USD) and ' +
    'organic social views, the same totals for the preceding period of equal length, and a ' +
    'daily series for each app. `comparable` is false when history does not reach back to ' +
    'the start of the preceding period, in which case the previous totals are incomplete.',
  input: overviewInput,
  async handler({ db }, input) {
    const range: DateRange = { from: input.from, to: input.to }
    const previousRange = previousPeriod(range)

    const [appRows, firstDays, rows] = await Promise.all([
      db.select().from(apps).where(eq(apps.isActive, true)).orderBy(asc(apps.name)),
      db
        .select({ appId: metricDaily.appId, firstDay: min(metricDaily.date) })
        .from(metricDaily)
        .groupBy(metricDaily.appId),
      db
        .select({
          appId: metricDaily.appId,
          date: metricDaily.date,
          downloads: headlineSum('downloads'),
          revenue: headlineSum('revenue'),
          socialViews: headlineSum('socialViews'),
        })
        .from(metricDaily)
        .where(and(gte(metricDaily.date, previousRange.from), lte(metricDaily.date, range.to)))
        .groupBy(metricDaily.appId, metricDaily.date),
    ])

    const byAppAndDay = new Map<string, HeadlineTotals>()
    for (const { appId, date, ...totals } of rows) byAppAndDay.set(`${appId}|${date}`, totals)

    const sumOver = (appId: string, days: string[]): HeadlineTotals => {
      const total = zeroTotals()
      for (const day of days) {
        const row = byAppAndDay.get(`${appId}|${day}`)
        if (!row) continue
        total.downloads += row.downloads
        total.revenue += row.revenue
        total.socialViews += row.socialViews
      }
      total.revenue = toCents(total.revenue)
      return total
    }

    const days = eachDay(range)
    const previousDays = eachDay(previousRange)

    // History starts at the first sync, so a new app has nothing to compare against at first.
    const firstDayByApp = new Map(firstDays.map((row) => [row.appId, row.firstDay]))
    const isComparable = (appId: string) => {
      const firstDay = firstDayByApp.get(appId)
      return firstDay != null && firstDay <= previousRange.from
    }

    const perApp = appRows.map((app) => ({
      app: { id: app.id, name: app.name, iconUrl: app.iconUrl },
      totals: sumOver(app.id, days),
      previous: sumOver(app.id, previousDays),
      comparable: isComparable(app.id),
      daily: days.map((date) => ({
        date,
        ...(byAppAndDay.get(`${app.id}|${date}`) ?? zeroTotals()),
      })),
    }))

    const add = (a: HeadlineTotals, b: HeadlineTotals): HeadlineTotals => ({
      downloads: a.downloads + b.downloads,
      revenue: toCents(a.revenue + b.revenue),
      socialViews: a.socialViews + b.socialViews,
    })

    return {
      range,
      previousRange,
      totals: perApp.map((a) => a.totals).reduce(add, zeroTotals()),
      previousTotals: perApp.map((a) => a.previous).reduce(add, zeroTotals()),
      // The portfolio totals are only comparable when every app that has data is.
      comparable: perApp.filter((a) => firstDayByApp.has(a.app.id)).every((a) => a.comparable),
      apps: perApp,
    }
  },
})
