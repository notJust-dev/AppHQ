import { and, eq } from 'drizzle-orm'
import { linkedAssets } from '../../assets/store.js'
import type { Scope, Tx } from '../../organizations/scope.js'
import { connections, postSnapshots, posts, type Connection, type NewMetric } from '../../db/schema.js'
import type { Secrets } from '../../lib/crypto.js'
import { todayUtc, toIsoDate, type IsoDate } from '../../lib/dates.js'
import type { Logger } from '../../lib/logger.js'
import { upsertMetrics } from '../../metrics/upsert.js'
import { savePosts, storedPosts, type PostReading } from '../../posts/save.js'
import type { AppConnector } from '../types.js'
import { TikTokError, createTikTokClient, type TikTokClient, type TikTokVideo } from './client.js'
import { TIKTOK, requireTikTokConfig, tiktokConfig } from './config.js'
import { dailyViews, type PostHistory } from './daily-views.js'
import { lacksViews, readVideos, type ReadVideo } from './readings.js'

/** Refresh a little early, so a token never expires halfway through a sync. */
const REFRESH_MARGIN_MS = 5 * 60_000

/** The TikTok accounts linked to an app, as their connection rows (tokens and state). */
const tiktokConnections = (scope: Scope, appId: string) =>
  linkedAssets(scope, 'tiktok_account', appId).then((rows) =>
    rows.flatMap((row) => (row.connection ? [row.connection] : [])),
  )

/**
 * Keeps one account's access token usable. TikTok's access tokens last two hours and every
 * refresh replaces the refresh token, so the new pair is saved, in a unit of work of its own,
 * before it is used.
 */
function tokenKeeper(deps: {
  scope: Scope
  secrets: Secrets
  client: TikTokClient
  now: () => Date
  connection: Connection
}) {
  const { scope, secrets, client, now } = deps
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
    await scope.run((db) =>
      db
        .update(connections)
        .set(update)
        .where(and(eq(connections.organizationId, scope.organizationId), eq(connections.id, connection.id))),
    )
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

/**
 * An account's videos whose totals can be saved. A video that comes without views is asked for
 * again by id, and left out when TikTok still has no count to believe (see `readVideos`): what
 * is stored for it stays, and the next sync reads it again.
 */
async function videosToSave(deps: {
  scope: Scope
  client: TikTokClient
  keeper: ReturnType<typeof tokenKeeper>
  log: Logger
  /** Says which account a log line is about. */
  label: string
}): Promise<ReadVideo[]> {
  const { scope, client, keeper, log, label } = deps
  const listed = await keeper.use((token) => client.listVideos(token))
  const doubtful = listed.filter(lacksViews)
  if (doubtful.length === 0) return readVideos({ listed, again: [], stored: new Map() }).videos

  const ids = doubtful.map((video) => video.id)
  let again: TikTokVideo[] = []
  try {
    again = await keeper.use((token) => client.queryVideos(token, ids))
  } catch (err) {
    // The list itself was read, so the other videos are still saved. An account that has to be
    // connected again must say so, though.
    if (err instanceof TikTokError && err.isAuthProblem) throw err
    const reason = err instanceof Error ? err.message : String(err)
    log.warn(`${label}: asking again for ${ids.length} videos failed. ${reason}`)
  }

  const stored = await storedPosts(scope, TIKTOK, ids)
  const { videos, recovered, skipped } = readVideos({ listed, again, stored })
  if (recovered + skipped > 0) {
    const noCount = doubtful.filter((video) => typeof video.view_count !== 'number').length
    log.warn(
      `${label}: ${doubtful.length} of ${listed.length} videos came without views ` +
        `(${noCount} with no count, ${doubtful.length - noCount} with zero). Asked again: ` +
        `${recovered} had views, ${skipped} were not saved this time`,
    )
  }
  return videos
}

const postRow = (video: ReadVideo, appId: string, connectionId: string): PostReading => ({
  platform: TIKTOK,
  externalId: video.id,
  appId,
  connectionId,
  url: video.share_url || null,
  caption: video.video_description || video.title || null,
  publishedAt: new Date(video.create_time * 1000),
  durationSeconds: video.duration ?? null,
  views: video.view_count,
  likes: video.like_count ?? 0,
  comments: video.comment_count ?? 0,
  shares: video.share_count ?? 0,
})

/**
 * Recomputes the app's daily TikTok views from every snapshot, per account, and writes them to
 * `metric_daily` as `views`. Each account counts from the day after it was connected up to its
 * last successful sync, so an account that is failing leaves a gap rather than zeros.
 */
async function writeDailyViews(scope: Scope, appId: string) {
  // Reads and writes only the database: one unit of work.
  return scope.run((db) => writeDailyViewsIn(db, scope, appId))
}

async function writeDailyViewsIn(db: Tx, scope: Scope, appId: string) {
  const { organizationId } = scope
  const accounts = await tiktokConnections(scope, appId)
  const readings = await db
    .select({
      postId: posts.id,
      connectionId: posts.connectionId,
      publishedAt: posts.publishedAt,
      date: postSnapshots.date,
      views: postSnapshots.views,
    })
    .from(posts)
    .innerJoin(
      postSnapshots,
      and(eq(postSnapshots.organizationId, posts.organizationId), eq(postSnapshots.postId, posts.id)),
    )
    .where(and(eq(posts.organizationId, organizationId), eq(posts.appId, appId), eq(posts.platform, TIKTOK)))

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
  return upsertMetrics(scope, rows)
}

/**
 * TikTok accounts, each connected to the app it promotes. Every sync reads each account's
 * public videos and saves their lifetime totals as today's snapshot; daily views are the gains
 * between days. TikTok keeps no history, so before an account was connected each video's views
 * sit on the day it was posted (see `dailyViews`). A video TikTok gives no believable view count
 * for is not saved that time (see `videosToSave`).
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

    async isConfigured(app, scope) {
      if (!tiktokConfig(options.env)) return false
      return (await tiktokConnections(scope, app.id)).length > 0
    },

    async sync(scope) {
      const { app, log, secrets } = scope
      const client = createTikTokClient({
        config: requireTikTokConfig(options.env),
        fetch: options.fetch,
        sleep: options.sleep,
        now,
      })
      const today = todayUtc(now())
      const accounts = await tiktokConnections(scope, app.id)
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
          const keeper = tokenKeeper({ scope, secrets, client, now, connection: account })
          const scopes = (account.scopes ?? '').split(',').filter(Boolean)
          const user = await keeper.use((token) => client.getUser(token, scopes))
          const videos = await videosToSave({ scope, client, keeper, log, label: `tiktok ${app.id}: ${name}` })

          await savePosts(
            scope,
            videos.map((video) => postRow(video, app.id, account.id)),
            today,
          )
          rowsWritten += videos.length
          if (typeof user.follower_count === 'number') {
            followers = (followers ?? 0) + user.follower_count
          }
          await scope.run((db) =>
            db
              .update(connections)
              .set({
                displayName: user.username ? `@${user.username}` : (user.display_name ?? account.displayName),
                status: 'ok',
                lastSyncedAt: now(),
                updatedAt: now(),
              })
              .where(and(eq(connections.organizationId, scope.organizationId), eq(connections.id, account.id))),
          )
          log.info(`tiktok ${app.id}: ${name}, ${videos.length} videos`)
        } catch (err) {
          const authProblem = err instanceof TikTokError && err.isAuthProblem
          await scope.run((db) =>
            db
              .update(connections)
              .set({ status: authProblem ? 'needs_reauth' : 'error', updatedAt: now() })
              .where(and(eq(connections.organizationId, scope.organizationId), eq(connections.id, account.id))),
          )
          failures.push(`${name}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }

      // Recomputed even when an account failed: the others' days are still right, and the
      // failed account's gap is shared out evenly once it syncs again.
      rowsWritten += await writeDailyViews(scope, app.id)
      // A partial follower total would look like a drop, so it is only written when complete.
      if (followers !== null && failures.length === 0) {
        rowsWritten += await upsertMetrics(scope, [
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
