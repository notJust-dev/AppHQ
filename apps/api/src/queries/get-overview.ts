import { and, asc, eq, gte, inArray, lte, min, sql } from 'drizzle-orm'
import { z } from 'zod'
import { appIcons } from '../assets/icons.js'
import { apps, metricDaily } from '../db/schema.js'
import { eachDay, previousPeriod, type DateRange } from '../lib/dates.js'
import { HEADLINE, type HeadlineKey } from '../metrics/catalog.js'
import { defineQuery } from './define.js'
import { checkRange, rangeFields } from './range.js'

export type HeadlineTotals = Record<HeadlineKey, number>
/** Whether any source reported a headline metric at all; a zero total can be either. */
export type HeadlineReporting = Record<HeadlineKey, boolean>

export const overviewInput = z.object(rangeFields).superRefine(checkRange)

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

/** How many rows report one headline metric, as a SQL aggregate. A row with zero counts. */
const headlineRows = (key: HeadlineKey) => {
  const { metric, sources } = HEADLINE[key]
  return sql<number>`count(*) filter (
    where ${metricDaily.metric} = ${metric} and ${inArray(metricDaily.source, [...sources])}
  )`.mapWith(Number)
}

const noReporting = (): HeadlineReporting => ({ downloads: false, revenue: false, socialViews: false })

export const getOverview = defineQuery({
  name: 'get_overview',
  description:
    'Portfolio overview for a date range: per-app totals for downloads, revenue (USD) and ' +
    'organic social views, the same totals for the preceding period of equal length, and a ' +
    'daily series for each app. `comparable` is false when history does not reach back to ' +
    'the start of the preceding period, in which case the previous totals are incomplete. ' +
    '`reporting` says, per app and for the portfolio, which totals rest on reported numbers: ' +
    'false means no source reported that metric in the range (no data), not zero.',
  input: overviewInput,
  async handler(scope, input) {
    const { db, organizationId } = scope
    const range: DateRange = { from: input.from, to: input.to }
    const previousRange = previousPeriod(range)

    const [appRows, firstDays, rows, icons] = await Promise.all([
      db
        .select()
        .from(apps)
        .where(and(eq(apps.organizationId, organizationId), eq(apps.isActive, true)))
        .orderBy(asc(apps.name)),
      db
        .select({ appId: metricDaily.appId, firstDay: min(metricDaily.date) })
        .from(metricDaily)
        .where(eq(metricDaily.organizationId, organizationId))
        .groupBy(metricDaily.appId),
      db
        .select({
          appId: metricDaily.appId,
          date: metricDaily.date,
          downloads: headlineSum('downloads'),
          revenue: headlineSum('revenue'),
          socialViews: headlineSum('socialViews'),
          downloadsRows: headlineRows('downloads'),
          revenueRows: headlineRows('revenue'),
          socialViewsRows: headlineRows('socialViews'),
        })
        .from(metricDaily)
        .where(
          and(
            eq(metricDaily.organizationId, organizationId),
            gte(metricDaily.date, previousRange.from),
            lte(metricDaily.date, range.to),
          ),
        )
        .groupBy(metricDaily.appId, metricDaily.date),
      appIcons(scope),
    ])

    const byAppAndDay = new Map<string, HeadlineTotals>()
    const reportedOn = new Map<string, HeadlineReporting>()
    for (const { appId, date, downloadsRows, revenueRows, socialViewsRows, ...totals } of rows) {
      byAppAndDay.set(`${appId}|${date}`, totals)
      reportedOn.set(`${appId}|${date}`, {
        downloads: downloadsRows > 0,
        revenue: revenueRows > 0,
        socialViews: socialViewsRows > 0,
      })
    }

    /** Which headline metrics any source reported for an app on any of these days. */
    const reportedOver = (appId: string, days: string[]): HeadlineReporting => {
      const reporting = noReporting()
      for (const day of days) {
        const on = reportedOn.get(`${appId}|${day}`)
        if (!on) continue
        reporting.downloads ||= on.downloads
        reporting.revenue ||= on.revenue
        reporting.socialViews ||= on.socialViews
      }
      return reporting
    }

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

    // Shared accounts count toward the totals, but only show as a row once they have numbers.
    const shown = appRows.filter((app) => app.kind !== 'portfolio' || firstDayByApp.has(app.id))
    const perApp = shown.map((app) => ({
      app: { id: app.id, name: app.name, kind: app.kind, iconUrl: app.iconUrl ?? icons.get(app.id) ?? null },
      totals: sumOver(app.id, days),
      previous: sumOver(app.id, previousDays),
      /** Which totals rest on reported numbers; false means no data, not zero. */
      reporting: reportedOver(app.id, days),
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
      reporting: perApp.reduce(
        (all, a): HeadlineReporting => ({
          downloads: all.downloads || a.reporting.downloads,
          revenue: all.revenue || a.reporting.revenue,
          socialViews: all.socialViews || a.reporting.socialViews,
        }),
        noReporting(),
      ),
      previousTotals: perApp.map((a) => a.previous).reduce(add, zeroTotals()),
      // The portfolio totals are only comparable when every app that has data is.
      comparable: perApp.filter((a) => firstDayByApp.has(a.app.id)).every((a) => a.comparable),
      apps: perApp,
    }
  },
})
