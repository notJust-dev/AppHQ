import { and, desc, eq, gte, inArray, lt, lte, max } from 'drizzle-orm'
import { z } from 'zod'
import { metricDaily, posts } from '../db/schema.js'
import { addDays, toIsoDate, type IsoDate } from '../lib/dates.js'
import { HEADLINE } from '../metrics/catalog.js'
import { lastCompleteDay } from '../metrics/complete.js'
import { BASELINE_DAYS, LIFT_DAYS, downloadLift } from '../metrics/post-lift.js'
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
  async handler({ db }, input) {
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
          eq(posts.appId, input.appId),
          gte(posts.publishedAt, new Date(`${input.from}T00:00:00Z`)),
          lt(posts.publishedAt, new Date(`${addDays(input.to, 1)}T00:00:00Z`)),
        ),
      )
      .orderBy(desc(posts.publishedAt))
      .limit(input.limit)
    if (rows.length === 0) return []

    const downloadFilter = and(
      eq(metricDaily.appId, input.appId),
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
            gte(metricDaily.date, addDays(input.from, -BASELINE_DAYS)),
            lte(metricDaily.date, addDays(input.to, LIFT_DAYS - 1)),
          ),
        ),
      db
        .select({ source: metricDaily.source, day: max(metricDaily.date) })
        .from(metricDaily)
        .where(downloadFilter)
        .groupBy(metricDaily.source),
    ])

    // Summed over the stores, like the downloads row of the timeline, and only up to the last
    // day every store still reporting has reached: Google Play posts days after the App Store.
    const byDay = new Map<IsoDate, number>()
    for (const { date, value } of downloadRows) byDay.set(date, (byDay.get(date) ?? 0) + value)
    const lastDays = new Map(
      latestBySource.flatMap(({ source, day }) => (day ? [[source, day] as const] : [])),
    )
    const lastReportedDay = lastCompleteDay(lastDays).through

    return rows.map((row) => ({
      ...row,
      publishedAt: row.publishedAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      downloadLift: downloadLift(byDay, toIsoDate(row.publishedAt), lastReportedDay),
    }))
  },
})
