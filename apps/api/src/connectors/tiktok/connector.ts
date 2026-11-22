import { and, eq } from 'drizzle-orm'
import { linkedAssets } from '../../assets/store.js'
import type { Db } from '../../db/client.js'
import { connections, postSnapshots, posts, type Connection, type NewMetric } from '../../db/schema.js'
import type { Secrets } from '../../lib/crypto.js'
import { todayUtc, toIsoDate, type IsoDate } from '../../lib/dates.js'
import { upsertMetrics } from '../../metrics/upsert.js'
import { savePosts, type PostReading } from '../../posts/save.js'
import type { AppConnector } from '../types.js'
import { TikTokError, createTikTokClient, type TikTokClient, type TikTokVideo } from './client.js'
import { TIKTOK, requireTikTokConfig, tiktokConfig } from './config.js'
import { dailyViews, type PostHistory } from './daily-views.js'

/** Refresh a little early, so a token never expires halfway through a sync. */
const REFRESH_MARGIN_MS = 5 * 60_000

/** The TikTok accounts linked to an app, as their connection rows (tokens and state). */
const tiktokConnections = (db: Db, appId: string) =>
  linkedAssets(db, 'tiktok_account', appId).then((rows) =>
    rows.flatMap((row) => (row.connection ? [row.connection] : [])),
  )

/**
 * Keeps one account's access token usable. TikTok's access tokens last two hours and every
 * refresh replaces the refresh token, so the new pair is saved before it is used.
 */
function tokenKeeper(deps: {
  db: Db
  secrets: Secrets
  client: TikTokClient
  now: () => Date
  connection: Connection
}) {
  const { db, secrets, client, now } = deps
  let connection = deps.connection

  async function refreshed(): Promise<string> {
    if (!connection.refreshTokenEnc) {
      throw new TikTokError(401, 'invalid_grant', 'No refresh token is stored for this account')
    }
    const tokens = await client.refresh(secrets.decrypt(connection.refreshTokenEnc))
    const update = {
      accessTokenEnc: secrets.encrypt(tokens.accessToken),
      refreshTokenEnc: secrets.encrypt(tokens.refreshToken),
      expiresAt: tokens.expiresAt,
      refreshExpiresAt: tokens.refreshExpiresAt ?? connection.refreshExpiresAt,
      scopes: tokens.scopes.length > 0 ? tokens.scopes.join(',') : connection.scopes,
      updatedAt: now(),
    }
    await db.update(connections).set(update).where(eq(connections.id, connection.id))
    connection = { ...connection, ...update }
    return tokens.accessToken
  }

  async function current(): Promise<string> {
    const expiresAt = connection.expiresAt?.getTime() ?? 0
    if (connection.accessTokenEnc && expiresAt - now().getTime() > REFRESH_MARGIN_MS) {
      return secrets.decrypt(connection.accessTokenEnc)
    }
    return refreshed()
  }

  return {
    /** Runs `work` with a valid token, refreshing once if TikTok says the token is no good. */
    async use<T>(work: (accessToken: string) => Promise<T>): Promise<T> {
      try {
        return await work(await current())
      } catch (err) {
        if (err instanceof TikTokError && err.code === 'access_token_invalid') {
          return work(await refreshed())
        }
        throw err
      }
    },
  }
}

const postRow = (video: TikTokVideo, appId: string, connectionId: string): PostReading => ({
  platform: TIKTOK,
  externalId: video.id,
  appId,
  connectionId,
  url: video.share_url || null,
  caption: video.video_description || video.title || null,
  publishedAt: new Date(video.create_time * 1000),
  durationSeconds: video.duration ?? null,
  views: video.view_count ?? 0,
  likes: video.like_count ?? 0,
  comments: video.comment_count ?? 0,
  shares: video.share_count ?? 0,
})


/**
 * Recomputes the app's daily TikTok views from every snapshot, per account, and writes them to
 * `metric_daily` as `views`. Each account counts from the day after it was connected up to its
 * last successful sync, so an account that is failing leaves a gap rather than zeros.
 */
async function writeDailyViews(db: Db, appId: string) {
  const accounts = await tiktokConnections(db, appId)
  const readings = await db
    .select({
      postId: posts.id,
      connectionId: posts.connectionId,
      publishedAt: posts.publishedAt,
      date: postSnapshots.date,
      views: postSnapshots.views,
    })
    .from(posts)
    .innerJoin(postSnapshots, eq(postSnapshots.postId, posts.id))
    .where(and(eq(posts.appId, appId), eq(posts.platform, TIKTOK)))

  const byAccount = new Map<string, Map<string, PostHistory>>()
  for (const reading of readings) {
    if (!reading.connectionId) continue
    const accountPosts = byAccount.get(reading.connectionId) ?? new Map<string, PostHistory>()
    const post = accountPosts.get(reading.postId) ?? {
      publishedOn: toIsoDate(reading.publishedAt),
      snapshots: [],
    }
    post.snapshots.push({ date: reading.date, views: reading.views })
    accountPosts.set(reading.postId, post)
    byAccount.set(reading.connectionId, accountPosts)
  }

  const totals = new Map<IsoDate, number>()
  for (const account of accounts) {
    if (!account.lastSyncedAt) continue
    const views = dailyViews({
      posts: [...(byAccount.get(account.id)?.values() ?? [])],
      watchStart: toIsoDate(account.createdAt),
      through: toIsoDate(account.lastSyncedAt),
    })
    for (const [day, value] of views) totals.set(day, (totals.get(day) ?? 0) + value)
  }

  const rows: NewMetric[] = [...totals].map(([date, value]) => ({
    appId,
    date,
    source: TIKTOK,
    metric: 'views',
    value,
  }))
  return upsertMetrics(db, rows)
}

/**
 * TikTok accounts, each connected to the app it promotes. Every sync reads each account's
 * public videos and saves their lifetime totals as today's snapshot; daily views are the gains
 * between days. TikTok keeps no history, so the series starts the day an account is connected.
 */
export function createTikTokConnector(
  options: {
    fetch?: typeof fetch
    sleep?: (ms: number) => Promise<void>
    now?: () => Date
    env?: NodeJS.ProcessEnv
  } = {},
): AppConnector {
  const now = options.now ?? (() => new Date())

  return {
    source: TIKTOK,
    scope: 'app',

    async isConfigured(app, db) {
      if (!tiktokConfig(options.env)) return false
      return (await tiktokConnections(db, app.id)).length > 0
    },

    async sync({ db, app, log, secrets }) {
      const client = createTikTokClient({
        config: requireTikTokConfig(options.env),
        fetch: options.fetch,
        sleep: options.sleep,
        now,
      })
      const today = todayUtc(now())
      const accounts = await tiktokConnections(db, app.id)
      const failures: string[] = []
      /** Summed over the accounts that report it; null until one does. */
      let followers: number | null = null
      let rowsWritten = 0

      for (const account of accounts) {
        const name = account.displayName ?? 'TikTok account'
        if (account.status === 'needs_reauth') {
          failures.push(`${name} has to be connected again`)
          continue
        }
        try {
          const keeper = tokenKeeper({ db, secrets, client, now, connection: account })
          const scopes = (account.scopes ?? '').split(',').filter(Boolean)
          const user = await keeper.use((token) => client.getUser(token, scopes))
          const videos = await keeper.use((token) => client.listVideos(token))

          await savePosts(
            db,
            videos.map((video) => postRow(video, app.id, account.id)),
            today,
          )
          rowsWritten += videos.length
          if (typeof user.follower_count === 'number') {
            followers = (followers ?? 0) + user.follower_count
          }
          await db
            .update(connections)
            .set({
              displayName: user.username ? `@${user.username}` : (user.display_name ?? account.displayName),
              status: 'ok',
              lastSyncedAt: now(),
              updatedAt: now(),
            })
            .where(eq(connections.id, account.id))
          log.info(`tiktok ${app.id}: ${name}, ${videos.length} videos`)
        } catch (err) {
          const authProblem = err instanceof TikTokError && err.isAuthProblem
          await db
            .update(connections)
            .set({ status: authProblem ? 'needs_reauth' : 'error', updatedAt: now() })
            .where(eq(connections.id, account.id))
          failures.push(`${name}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }

      // Recomputed even when an account failed: the others' days are still right, and the
      // failed account's gap is shared out evenly once it syncs again.
      rowsWritten += await writeDailyViews(db, app.id)
      // A partial follower total would look like a drop, so it is only written when complete.
      if (followers !== null && failures.length === 0) {
        rowsWritten += await upsertMetrics(db, [
          { appId: app.id, date: today, source: TIKTOK, metric: 'followers', value: followers },
        ])
      }

      if (failures.length > 0) {
        throw new Error(`${failures.length} of ${accounts.length} TikTok accounts failed. ${failures.join('; ')}`)
      }
      return { rowsWritten }
    },
  }
}
