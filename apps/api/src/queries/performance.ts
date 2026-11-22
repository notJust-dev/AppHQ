import { and, desc, eq, gte, inArray, lt, lte, type SQL } from 'drizzle-orm'
import { z } from 'zod'
import type { Db } from '../db/client.js'
import { apps, metricDaily, posts } from '../db/schema.js'
import { addDays, eachDay, previousPeriod, toIsoDate, type DateRange, type IsoDate } from '../lib/dates.js'
import { PERFORMANCE } from '../metrics/catalog.js'
import { defineQuery } from './define.js'
import { buildSeries, type MetricRow, type SeriesDefinition } from './get-app-timeline.js'
import { downloadLifts } from './list-posts.js'
import { checkRange, rangeFields } from './range.js'

const input = z
  .object({
    ...rangeFields,
    appId: z
      .string()
      .min(1)
      .max(64)
      .optional()
      .describe('Limit to one app (an id from list_apps). Every app, shared accounts included, when left out.'),
  })
  .superRefine(checkRange)

type Input = z.infer<typeof input>

const SERIES_NOTE =
  'Each series has one value per day (null where no source reported), a summary over the ' +
  'range (a total, or the latest value for levels), the summary of the previous period of the ' +
  'same length for comparison, and the same broken down by source. Sources report with ' +
  'different delays, so a total stops at `completeThrough` while some sources (`waitingFor`) ' +
  'catch up. `apps` gives each app’s summaries over the range and the period before, overall ' +
  'and by source, for apps with any data: a ratio such as revenue per download is only fair ' +
  'over the apps (and stores) that report both of its numbers.'

/** Sums rows over apps, so each day, source and metric has one value. */
function sumOverApps(rows: (MetricRow & { appId: string })[]): MetricRow[] {
  const sums = new Map<string, MetricRow>()
  for (const row of rows) {
    const key = `${row.date}|${row.source}|${row.metric}`
    const found = sums.get(key)
    if (found) found.value += row.value
    else sums.set(key, { date: row.date, source: row.source, metric: row.metric, value: row.value })
  }
  return [...sums.values()]
}

/**
 * One performance page's series over a range and the period before it, summed over the chosen
 * apps, with each app's summaries for the comparison table.
 */
async function loadSection<D extends SeriesDefinition>(db: Db, definitions: readonly D[], range: Input) {
  const previous = previousPeriod(range)
  const appFilter: SQL | undefined = range.appId ? eq(metricDaily.appId, range.appId) : undefined

  const [rows, appRows] = await Promise.all([
    db
      .select({
        appId: metricDaily.appId,
        date: metricDaily.date,
        source: metricDaily.source,
        metric: metricDaily.metric,
        value: metricDaily.value,
      })
      .from(metricDaily)
      .where(
        and(
          appFilter,
          gte(metricDaily.date, previous.from),
          lte(metricDaily.date, range.to),
          eq(metricDaily.dimension, ''),
          inArray(metricDaily.metric, [...new Set(definitions.map((definition) => definition.metric))]),
        ),
      ),
    db
      .select({ id: apps.id, name: apps.name, kind: apps.kind })
      .from(apps)
      .where(range.appId ? eq(apps.id, range.appId) : undefined)
      .orderBy(apps.name),
  ])

  const inRange = (row: { date: IsoDate }, { from, to }: DateRange) => row.date >= from && row.date <= to
  const days = eachDay(range)
  const current = buildSeries(definitions, sumOverApps(rows.filter((row) => inRange(row, range))), days)
  const before = buildSeries(definitions, sumOverApps(rows.filter((row) => inRange(row, previous))), eachDay(previous))

  const series = current.map((entry, index) => {
    const earlier = before[index]
    return {
      ...entry,
      previous: earlier?.summary ?? null,
      sources: entry.sources.map((part) => ({
        ...part,
        previous: earlier?.sources.find((other) => other.source === part.source)?.summary ?? null,
      })),
    }
  })

  type Key = D['key']
  /** Each series' summary, overall and by source, for one app's rows over one period. */
  const summarise = (own: MetricRow[], period: IsoDate[]) => {
    const built = buildSeries(definitions, own, period)
    return {
      totals: Object.fromEntries(built.map((entry) => [entry.key, entry.summary])) as Record<Key, number | null>,
      bySource: Object.fromEntries(
        built.map((entry) => [entry.key, Object.fromEntries(entry.sources.map((part) => [part.source, part.summary]))]),
      ) as Record<Key, Record<string, number | null>>,
    }
  }
  const previousDays = eachDay(previous)
  const perApp = appRows
    .map((app) => {
      const own = rows.filter((row) => row.appId === app.id)
      const now = summarise(own.filter((row) => inRange(row, range)), days)
      const then = summarise(own.filter((row) => inRange(row, previous)), previousDays)
      return {
        app,
        totals: now.totals,
        bySource: now.bySource,
        previous: then.totals,
        previousBySource: then.bySource,
      }
    })
    .filter((entry) => Object.values(entry.totals).some((value) => value !== null))

  return {
    result: {
      range: { from: range.from, to: range.to },
      previousRange: previous,
      days,
      series,
      apps: perApp,
    },
    /** Every row read, for figures a page works out beyond the series. */
    rows: rows.filter((row) => inRange(row, range)),
  }
}

/**
 * A daily rate such as downloads per page view, over only the apps and sources that reported
 * both numbers that day: an app whose page views are not reported must not add its downloads.
 */
function pairedDaily(rows: (MetricRow & { appId: string })[], numerator: string, denominator: string, days: IsoDate[]) {
  const pairs = new Map<string, { top?: number; bottom?: number }>()
  for (const row of rows) {
    if (row.metric !== numerator && row.metric !== denominator) continue
    const key = `${row.date}|${row.appId}|${row.source}`
    const pair = pairs.get(key) ?? {}
    if (row.metric === numerator) pair.top = (pair.top ?? 0) + row.value
    else pair.bottom = (pair.bottom ?? 0) + row.value
    pairs.set(key, pair)
  }
  const byDay = new Map<IsoDate, { top: number; bottom: number }>()
  for (const [key, pair] of pairs) {
    if (pair.top === undefined || pair.bottom === undefined) continue
    const day = key.slice(0, 10)
    const sum = byDay.get(day) ?? { top: 0, bottom: 0 }
    sum.top += pair.top
    sum.bottom += pair.bottom
    byDay.set(day, sum)
  }
  return days.map((day) => {
    const sum = byDay.get(day)
    return sum && sum.bottom > 0 ? Math.round((sum.top / sum.bottom) * 10_000) / 10_000 : null
  })
}

/** How many posts went up each day, per platform, aligned with `days`. */
function postsPerDay(rows: { platform: string; publishedAt: Date }[], days: IsoDate[]) {
  const dayIndex = new Map(days.map((day, index) => [day, index]))
  const byPlatform = new Map<string, number[]>()
  for (const row of rows) {
    const index = dayIndex.get(toIsoDate(row.publishedAt))
    if (index === undefined) continue
    const counts = byPlatform.get(row.platform) ?? days.map(() => 0)
    counts[index] = (counts[index] ?? 0) + 1
    byPlatform.set(row.platform, counts)
  }
  return [...byPlatform].map(([platform, values]) => ({ platform, values }))
}

const TOP_POSTS = 10

export const getSocialPerformance = defineQuery({
  name: 'get_social_performance',
  description:
    'Social media performance over a date range, for one app or all: daily social views and ' +
    'followers by platform (TikTok, Instagram, Facebook), daily store downloads to set them ' +
    'against, how many posts went up (per platform and per day) with their lifetime views, ' +
    'likes, comments and shares, and the most viewed posts of the range with the download lift ' +
    'after each (downloads over the post’s day and the two after, against the week before; ' +
    'lift against a baseline, not attribution). ' +
    SERIES_NOTE,
  input,
  async handler({ db }, range) {
    const { result: section } = await loadSection(db, PERFORMANCE.social, range)
    const postRows = await db
      .select({
        id: posts.id,
        appId: posts.appId,
        platform: posts.platform,
        url: posts.url,
        caption: posts.caption,
        publishedAt: posts.publishedAt,
        views: posts.views,
        likes: posts.likes,
        comments: posts.comments,
        shares: posts.shares,
      })
      .from(posts)
      .where(
        and(
          range.appId ? eq(posts.appId, range.appId) : undefined,
          gte(posts.publishedAt, new Date(`${range.from}T00:00:00Z`)),
          lt(posts.publishedAt, new Date(`${addDays(range.to, 1)}T00:00:00Z`)),
        ),
      )
      .orderBy(desc(posts.views))

    const platforms = new Map<string, { platform: string; posts: number; views: number; likes: number; comments: number; shares: number }>()
    for (const post of postRows) {
      const entry = platforms.get(post.platform) ?? { platform: post.platform, posts: 0, views: 0, likes: 0, comments: 0, shares: 0 }
      entry.posts += 1
      entry.views += post.views
      entry.likes += post.likes
      entry.comments += post.comments
      entry.shares += post.shares
      platforms.set(post.platform, entry)
    }

    const top = postRows.slice(0, TOP_POSTS)
    const lifts = new Map(
      await Promise.all(
        [...new Set(top.map((post) => post.appId))].map(
          async (appId) => [appId, await downloadLifts(db, appId, range)] as const,
        ),
      ),
    )
    const appNames = new Map(section.apps.map((entry) => [entry.app.id, entry.app.name]))
    const appName = async (appId: string) => {
      const known = appNames.get(appId)
      if (known) return known
      const [row] = await db.select({ name: apps.name }).from(apps).where(eq(apps.id, appId)).limit(1)
      return row?.name ?? appId
    }

    return {
      ...section,
      posts: {
        byPlatform: [...platforms.values()].sort((a, b) => b.views - a.views),
        perDay: postsPerDay(postRows, section.days),
        top: await Promise.all(
          top.map(async (post) => ({
            ...post,
            appName: await appName(post.appId),
            publishedAt: post.publishedAt.toISOString(),
            downloadLift: lifts.get(post.appId)?.(post.publishedAt) ?? { status: 'no_downloads' as const },
          })),
        ),
      },
    }
  },
})

export const getStorePerformance = defineQuery({
  name: 'get_store_performance',
  description:
    'Store performance over a date range, for one app or all: the funnel from App Store ' +
    'impressions to store page views (App Store product page views, Google Play store listing ' +
    'visitors) to downloads, daily and by store, and `conversion`: downloads per page view each ' +
    'day over the apps and stores that report both. Google Play reports no impressions. ' +
    SERIES_NOTE,
  input,
  async handler({ db }, range) {
    const { result, rows } = await loadSection(db, PERFORMANCE.store, range)
    return {
      ...result,
      /** Downloads per store page view each day, over the apps and stores that report both. */
      conversion: pairedDaily(rows, 'downloads', 'page_views', result.days),
    }
  },
})

export const getMonetisationPerformance = defineQuery({
  name: 'get_monetisation_performance',
  description:
    'Monetisation over a date range, for one app or all, from RevenueCat: revenue (USD), MRR, ' +
    'active subscriptions and trials (levels: the summary is the latest value), trials started ' +
    'and new customers, plus store downloads to work out revenue per download. ' +
    SERIES_NOTE,
  input,
  handler: async ({ db }, range) => (await loadSection(db, PERFORMANCE.monetisation, range)).result,
})

export const getSearchPerformance = defineQuery({
  name: 'get_search_performance',
  description:
    'Google search performance over a date range, for one app or all, from Search Console: ' +
    'clicks and impressions of the websites linked to apps, and `positionSum`, the average ' +
    'position times impressions (divide by impressions for the average position; lower is ' +
    'better). Google posts a day two or three days late. ' +
    SERIES_NOTE,
  input,
  handler: async ({ db }, range) => (await loadSection(db, PERFORMANCE.search, range)).result,
})
