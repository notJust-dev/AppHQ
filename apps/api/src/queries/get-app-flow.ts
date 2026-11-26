import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm'
import { z } from 'zod'
import { apps, metricDaily } from '../db/schema.js'
import { SOCIAL_SOURCES, STORE_SOURCES } from '../metrics/catalog.js'
import { defineQuery } from './define.js'
import { checkRange, rangeFields } from './range.js'

const input = z
  .object({
    appId: z.uuid().describe('The app, an id from list_apps.'),
    ...rangeFields,
  })
  .superRefine(checkRange)

/** RevenueCat metrics read as one total each. */
const REVENUECAT_METRICS = ['trials', 'trial_conversions', 'trial_expirations', 'trials_pending', 'direct_subs'] as const

export const getAppFlow = defineQuery({
  name: 'get_app_flow',
  description:
    "One app's way from attention to paying over a range, as totals: social views by platform, " +
    'downloads by store, trials started, what became of the trials started in the range ' +
    '(converted, expired, or still running, counted by the day each trial started), and paid ' +
    'subscriptions bought without a trial. A total is null when no source reported it. The ' +
    'stages are counted over the same days, not followed person by person: a download is not ' +
    'traced back to a view.',
  input,
  async handler(scope, input) {
    const { organizationId } = scope
    const rows = await scope.run(async (db) => {
      const [app] = await db.select({ id: apps.id }).from(apps).where(and(eq(apps.organizationId, organizationId), eq(apps.id, input.appId))).limit(1)
      if (!app) return null

      return db
      .select({
        source: metricDaily.source,
        metric: metricDaily.metric,
        total: sql<number>`sum(${metricDaily.value})`.mapWith(Number),
      })
      .from(metricDaily)
      .where(
        and(
          eq(metricDaily.organizationId, organizationId),
          eq(metricDaily.appId, input.appId),
          gte(metricDaily.date, input.from),
          lte(metricDaily.date, input.to),
          eq(metricDaily.dimension, ''),
          inArray(metricDaily.metric, ['views', 'downloads', ...REVENUECAT_METRICS]),
        ),
      )
      .groupBy(metricDaily.source, metricDaily.metric)
    })
    if (!rows) return null

    /** A metric's total and its parts by source, over the sources that report it. */
    const split = (metric: string, sources: readonly string[]) => {
      const parts = rows.filter((row) => row.metric === metric && sources.includes(row.source))
      return {
        total: parts.length === 0 ? null : parts.reduce((sum, row) => sum + row.total, 0),
        bySource: Object.fromEntries(parts.map((row) => [row.source, row.total])) as Record<string, number>,
      }
    }
    const revenueCat = (metric: (typeof REVENUECAT_METRICS)[number]) =>
      rows.find((row) => row.metric === metric && row.source === 'revenuecat')?.total ?? null

    return {
      range: { from: input.from, to: input.to },
      socialViews: split('views', SOCIAL_SOURCES),
      downloads: split('downloads', STORE_SOURCES),
      trials: revenueCat('trials'),
      /** The trials started in the range, by what became of them so far. */
      trialOutcomes: {
        converted: revenueCat('trial_conversions'),
        expired: revenueCat('trial_expirations'),
        running: revenueCat('trials_pending'),
      },
      directSubscriptions: revenueCat('direct_subs'),
    }
  },
})
