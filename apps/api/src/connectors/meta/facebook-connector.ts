import { addDays, todayUtc, type IsoDate } from '../../lib/dates.js'
import { upsertMetrics } from '../../metrics/upsert.js'
import { savePosts, storedPosts, type PostReading } from '../../posts/save.js'
import type { AppConnector } from '../types.js'
import { createMetaClient, type MetaClient } from './client.js'
import { FACEBOOK, metaConfig, requireMetaConfig } from './config.js'
import { dayEndingAt, pacificMidnight, parseMetaTime } from './days.js'
import {
  DailyTotals,
  FRESH_POST_DAYS,
  POST_HISTORY_DAYS,
  describe,
  isPartial,
  markAccount,
  metaConnections,
} from './shared.js'

/** Page insights stored per day. Meta keeps two years of them. */
const PAGE_METRICS = [
  { metric: 'page_media_view', name: 'views' },
  { metric: 'page_total_media_view_unique', name: 'reach' },
  { metric: 'page_post_engagements', name: 'engagements' },
  { metric: 'page_follows', name: 'followers' },
] as const
const INSIGHTS_HISTORY_DAYS = 730

/**
 * The Facebook Pages connected to an app: daily views, reach, engagements and followers from
 * Page insights, plus the Page's posts and reels with their lifetime views.
 */
export function createFacebookConnector(
  options: { fetch?: typeof fetch; now?: () => Date; env?: NodeJS.ProcessEnv } = {},
): AppConnector {
  const now = options.now ?? (() => new Date())

  return {
    source: FACEBOOK,
    scope: 'app',

    async isConfigured(app, db) {
      if (!metaConfig(options.env)) return false
      return (await metaConnections(db, FACEBOOK, app.id)).length > 0
    },

    async sync({ db, app, range, log, secrets }) {
      const client = createMetaClient({ config: requireMetaConfig(options.env), fetch: options.fetch })
      const today = todayUtc(now())
      const from = maxDay(range.from, addDays(today, -INSIGHTS_HISTORY_DAYS))
      const totals = new DailyTotals()
      const failures: string[] = []
      const warnings: string[] = []
      let rowsWritten = 0

      const accounts = await metaConnections(db, FACEBOOK, app.id)
      for (const account of accounts) {
        const name = account.displayName ?? 'Facebook Page'
        if (account.status === 'needs_reauth' || !account.accessTokenEnc) {
          failures.push(`${name} has to be connected again`)
          continue
        }
        try {
          const token = secrets.decrypt(account.accessTokenEnc)
          const pageId = account.externalAccountId ?? ''

          for (const { metric, name: stored } of PAGE_METRICS) {
            try {
              for (const point of await client.pageMetric(token, pageId, metric, from, range.to)) {
                const day = dayEndingAt(point.endTime)
                if (day >= from && day <= range.to) totals.add(stored, day, point.value)
              }
            } catch (err) {
              if (!isPartial(err)) throw err
              warnings.push(`${name} ${metric}: ${describe(err)}`)
            }
          }

          const readings = await readPosts(client, token, pageId, {
            appId: app.id,
            connectionId: account.id,
            today,
            db,
            warn: (message) => warnings.push(`${name}: ${message}`),
          })
          rowsWritten += await savePosts(db, readings, today)
          await markAccount(db, account.id, { ok: true, now: now() })
        } catch (err) {
          await markAccount(db, account.id, { ok: false, err, now: now() })
          failures.push(`${name}: ${describe(err)}`)
        }
      }

      rowsWritten += await upsertMetrics(db, totals.rows(app.id, FACEBOOK))
      for (const warning of warnings.slice(0, 5)) log.warn(`facebook ${app.id}: ${warning}`)
      if (failures.length > 0) {
        throw new Error(`${failures.length} of ${accounts.length} Facebook Pages failed. ${failures.join('; ')}`)
      }
      return { rowsWritten }
    },
  }
}

/**
 * The Page's posts and reels from the last year. New and recent ones get their views read;
 * older ones keep the totals already stored, which no longer change much.
 */
async function readPosts(
  client: MetaClient,
  token: string,
  pageId: string,
  ctx: {
    db: Parameters<typeof storedPosts>[0]
    appId: string
    connectionId: string
    today: IsoDate
    warn: (message: string) => void
  },
): Promise<PostReading[]> {
  const since = pacificMidnight(addDays(ctx.today, -POST_HISTORY_DAYS))
  const freshSince = Date.parse(`${addDays(ctx.today, -FRESH_POST_DAYS)}T00:00:00Z`)

  const posts = await client.pagePosts(token, pageId, since)
  const reels = await client.pageReels(token, pageId, since).catch((err: unknown) => {
    if (!isPartial(err)) throw err
    ctx.warn(`reels: ${describe(err)}`)
    return []
  })
  const items = [
    ...posts.map((post) => ({
      id: post.id,
      at: parseMetaTime(post.created_time),
      caption: post.message ?? null,
      url: post.permalink_url ?? null,
      duration: null as number | null,
      likes: post.reactions?.summary?.total_count ?? 0,
      comments: post.comments?.summary?.total_count ?? 0,
      shares: post.shares?.count ?? 0,
      insights: { path: `/${post.id}/insights`, metric: 'post_media_view' },
    })),
    ...reels.map((reel) => ({
      id: reel.id,
      at: parseMetaTime(reel.created_time ?? reel.updated_time ?? new Date().toISOString()),
      caption: reel.description ?? null,
      url: reel.permalink_url
        ? new URL(reel.permalink_url, 'https://www.facebook.com').toString()
        : null,
      duration: reel.length ? Math.round(reel.length) : null,
      likes: 0,
      comments: 0,
      shares: 0,
      insights: { path: `/${reel.id}/video_insights`, metric: 'blue_reels_play_count' },
    })),
  ]

  const stored = await storedPosts(ctx.db, FACEBOOK, items.map((item) => item.id))
  const readings: PostReading[] = []
  let insightFailures = 0
  for (const item of items) {
    const known = stored.get(item.id)
    let views = known?.views ?? 0
    if (!known || item.at.getTime() >= freshSince) {
      try {
        views = (await client.lifetime(token, item.insights.path, item.insights.metric)) ?? views
      } catch (err) {
        if (!isPartial(err)) throw err
        insightFailures++
      }
    }
    readings.push({
      platform: FACEBOOK,
      externalId: item.id,
      appId: ctx.appId,
      connectionId: ctx.connectionId,
      url: item.url,
      caption: item.caption,
      publishedAt: item.at,
      durationSeconds: item.duration,
      views,
      likes: item.likes,
      comments: item.comments,
      shares: item.shares || (known?.shares ?? 0),
    })
  }
  if (insightFailures > 0) ctx.warn(`views missing for ${insightFailures} posts`)
  return readings
}

const maxDay = (a: IsoDate, b: IsoDate) => (a > b ? a : b)
