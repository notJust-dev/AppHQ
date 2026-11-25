import { and, desc, eq, gte, inArray, lt, lte, max } from 'drizzle-orm'
import { z } from 'zod'
import { metricDaily, posts } from '../db/schema.js'
import { addDays, toIsoDate, type IsoDate } from '../lib/dates.js'
import { HEADLINE } from '../metrics/catalog.js'
import { lastCompleteDay } from '../metrics/complete.js'
import { BASELINE_DAYS, LIFT_DAYS, downloadLift, type DownloadLift } from '../metrics/post-lift.js'
import type { Scope } from '../organizations/scope.js'
import { defineQuery } from './define.js'
import { checkRange, rangeFields } from './range.js'

const DOWNLOADS = HEADLINE.downloads

export const listPosts = defineQuery({
  name: 'list_posts',
  description:
    "One app's social posts published in a date range, newest first. Each has its platform, " +
    'caption, link, publish time and lifetime totals (views, likes, comments, shares) as of ' +
    'the last sync; older posts have had longer to collect them. `downloadLift` compares the ' +
    `app's downloads over the post's day and the ${LIFT_DAYS - 1} after with what the ` +
    `${BASELINE_DAYS} days before would predict. It is lift against a baseline, not ` +
    'attribution: posts close together share the same days. Its status is "ok", or ' +
    '"too_recent", "no_baseline" or "no_downloads" when it cannot be worked out.',
  input: z
    .object({
      appId: z.string().min(1).max(64).describe('The app id from list_apps.'),
      ...rangeFields,
      limit: z.number().int().min(1).max(200).default(50).describe('At most this many posts.'),
    })
    .superRefine(checkRange),
  async handler(scope, input) {
    const { db, organizationId } = scope
    const rows = await db
      .select({
        id: posts.id,
        platform: posts.platform,
        url: posts.url,
        caption: posts.caption,
        publishedAt: posts.publishedAt,
        durationSeconds: posts.durationSeconds,
        views: posts.views,
        likes: posts.likes,
        comments: posts.comments,
        shares: posts.shares,
        updatedAt: posts.updatedAt,
      })
      .from(posts)
      .where(
        and(
          eq(posts.organizationId, organizationId),
          eq(posts.appId, input.appId),
          gte(posts.publishedAt, new Date(`${input.from}T00:00:00Z`)),
          lt(posts.publishedAt, new Date(`${addDays(input.to, 1)}T00:00:00Z`)),
        ),
      )
      .orderBy(desc(posts.publishedAt))
      .limit(input.limit)
    if (rows.length === 0) return []

    const liftOf = await downloadLifts(scope, input.appId, input)

    return rows.map((row) => ({
      ...row,
      publishedAt: row.publishedAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      downloadLift: liftOf(row.publishedAt),
    }))
  },
})

/**
 * How an app's downloads moved after each of its posts in a range: reads the downloads the
 * lift needs once, then answers per post. Downloads are summed over the stores, like the
 * downloads row of the timeline, and only up to the last day every store still reporting has
 * reached: Google Play posts days after the App Store.
 */
export async function downloadLifts(
  { db, organizationId }: Scope,
  appId: string,
  range: { from: IsoDate; to: IsoDate },
): Promise<(publishedAt: Date) => DownloadLift> {
  const downloadFilter = and(
    eq(metricDaily.organizationId, organizationId),
    eq(metricDaily.appId, appId),
    eq(metricDaily.metric, DOWNLOADS.metric),
    eq(metricDaily.dimension, ''),
    inArray(metricDaily.source, [...DOWNLOADS.sources]),
  )
  const [downloadRows, latestBySource] = await Promise.all([
    db
      .select({ date: metricDaily.date, value: metricDaily.value })
      .from(metricDaily)
      .where(
        and(
          downloadFilter,
          gte(metricDaily.date, addDays(range.from, -BASELINE_DAYS)),
          lte(metricDaily.date, addDays(range.to, LIFT_DAYS - 1)),
        ),
      ),
    db
      .select({ source: metricDaily.source, day: max(metricDaily.date) })
      .from(metricDaily)
      .where(downloadFilter)
      .groupBy(metricDaily.source),
  ])

  const byDay = new Map<IsoDate, number>()
  for (const { date, value } of downloadRows) byDay.set(date, (byDay.get(date) ?? 0) + value)
  const lastDays = new Map(
    latestBySource.flatMap(({ source, day }) => (day ? [[source, day] as const] : [])),
  )
  const lastReportedDay = lastCompleteDay(lastDays).through
  return (publishedAt) => downloadLift(byDay, toIsoDate(publishedAt), lastReportedDay)
}
