import { eq } from 'drizzle-orm'
import { linkedAssets } from '../../assets/store.js'
import type { Db } from '../../db/client.js'
import { connections, type Connection, type NewMetric } from '../../db/schema.js'
import type { Secrets } from '../../lib/crypto.js'
import { addDays, parseIsoDate, todayUtc } from '../../lib/dates.js'
import { upsertMetrics } from '../../metrics/upsert.js'
import { savePosts, type PostReading } from '../../posts/save.js'
import type { AppConnector } from '../types.js'
import { YouTubeError, createYouTubeClient, type YouTubeClient } from './client.js'
import { YOUTUBE, requireYouTubeConfig, youtubeConfig } from './config.js'

/** How far back videos are listed for the Social page and the app's posts. */
const POST_HISTORY_DAYS = 365

/** The YouTube channels linked to an app, as their connection rows (tokens, state). */
const channelConnections = (db: Db, appId: string) =>
  linkedAssets(db, 'youtube_channel', appId).then((rows) => rows.flatMap((row) => (row.connection ? [row.connection] : [])))

/**
 * A working access token: the stored one while it lasts, a refreshed one (saved) after that.
 * Google access tokens last an hour; the refresh token lasts until access is withdrawn.
 */
async function accessToken(db: Db, secrets: Secrets, client: YouTubeClient, connection: Connection, now: Date) {
  const fresh = connection.expiresAt && connection.expiresAt.getTime() - 60_000 > now.getTime()
  if (fresh && connection.accessTokenEnc) return secrets.decrypt(connection.accessTokenEnc)
  if (!connection.refreshTokenEnc) throw new YouTubeError(401, 'invalid_grant', 'No refresh token is stored')
  const tokens = await client.refresh(secrets.decrypt(connection.refreshTokenEnc))
  await db
    .update(connections)
    .set({
      accessTokenEnc: secrets.encrypt(tokens.access_token),
      expiresAt: new Date(now.getTime() + (tokens.expires_in ?? 3600) * 1000),
      updatedAt: now,
    })
    .where(eq(connections.id, connection.id))
  return tokens.access_token
}

/**
 * The YouTube channels connected to an app: daily views, likes, comments and shares from
 * YouTube Analytics (posted two or three days late), subscribers as followers, and the videos
 * of the last year with their lifetime views, likes and comments.
 */
export function createYouTubeConnector(
  options: { fetch?: typeof fetch; now?: () => Date; env?: NodeJS.ProcessEnv } = {},
): AppConnector {
  const now = options.now ?? (() => new Date())

  return {
    source: YOUTUBE,
    scope: 'app',

    async isConfigured(app, db) {
      if (!youtubeConfig(options.env)) return false
      return (await channelConnections(db, app.id)).length > 0
    },

    async sync({ db, app, range, secrets }) {
      const client = createYouTubeClient({ config: requireYouTubeConfig(options.env), fetch: options.fetch })
      const today = todayUtc(now())
      const totals = new Map<string, number>()
      const add = (metric: string, date: string, value: number) =>
        totals.set(`${metric}|${date}`, (totals.get(`${metric}|${date}`) ?? 0) + value)
      const failures: string[] = []
      let followersComplete = true
      let rowsWritten = 0

      const channels = await channelConnections(db, app.id)
      for (const connection of channels) {
        const name = connection.displayName ?? 'YouTube channel'
        if (connection.status === 'needs_reauth') {
          failures.push(`${name} has to be connected again`)
          followersComplete = false
          continue
        }
        try {
          const token = await accessToken(db, secrets, client, connection, now())
          const channel = await client.myChannel(token)
          if (channel?.subscribers !== null && channel?.subscribers !== undefined) add('followers', today, channel.subscribers)
          else followersComplete = false

          for (const day of await client.daily(token, range.from, range.to)) {
            add('views', day.date, day.views)
            add('likes', day.date, day.likes)
            add('comments', day.date, day.comments)
            add('shares', day.date, day.shares)
          }

          const uploads =
            channel?.uploadsPlaylistId ??
            ((connection.details as { uploadsPlaylistId?: string } | null)?.uploadsPlaylistId ?? null)
          if (uploads) {
            const since = parseIsoDate(addDays(today, -POST_HISTORY_DAYS))
            const readings: PostReading[] = (await client.videosSince(token, uploads, since)).map((video) => ({
              platform: YOUTUBE,
              externalId: video.id,
              appId: app.id,
              connectionId: connection.id,
              url: `https://www.youtube.com/watch?v=${video.id}`,
              caption: video.title,
              publishedAt: video.publishedAt,
              durationSeconds: video.durationSeconds,
              views: video.views,
              likes: video.likes,
              comments: video.comments,
              shares: 0,
            }))
            rowsWritten += await savePosts(db, readings, today)
          }

          await db
            .update(connections)
            .set({ status: 'ok', lastSyncedAt: now(), updatedAt: now() })
            .where(eq(connections.id, connection.id))
        } catch (err) {
          followersComplete = false
          const lost = err instanceof YouTubeError && err.isAuthProblem
          await db
            .update(connections)
            .set({ status: lost ? 'needs_reauth' : 'error', updatedAt: now() })
            .where(eq(connections.id, connection.id))
          failures.push(`${name}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }

      let rows: NewMetric[] = [...totals].map(([key, value]) => {
        const [metric = '', date = ''] = key.split('|')
        return { appId: app.id, date, source: YOUTUBE, metric, value }
      })
      // A partial follower total would look like a drop, so it is only written when complete.
      if (!followersComplete) rows = rows.filter((row) => row.metric !== 'followers')
      rowsWritten += await upsertMetrics(db, rows)
      if (failures.length > 0) {
        throw new Error(`${failures.length} of ${channels.length} YouTube channels failed. ${failures.join('; ')}`)
      }
      return { rowsWritten }
    },
  }
}
