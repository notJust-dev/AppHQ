import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { assignAsset } from '../assets/store.js'
import { parseDuration } from '../connectors/youtube/client.js'
import { createYouTubeConnector } from '../connectors/youtube/connector.js'
import { createDb } from '../db/client.js'
import { runMigrations } from '../db/migrate.js'
import { apps, assets, connections, metricDaily, posts } from '../db/schema.js'
import { createSecrets } from '../lib/crypto.js'
import { testDatabaseUrl } from '../test/database.js'
import { defaultScope } from '../test/organizations.js'
import type { Scope } from '../organizations/scope.js'
import { ConnectInputError } from './connect-app-store.js'
import { connectYouTube } from './connect-youtube.js'

// Runs only when a database is provided: TEST_DATABASE_URL=postgres://.../appdashboard_test
const url = testDatabaseUrl()

describe.skipIf(!url)('YouTube, against a real database', () => {
  const { db, sql } = createDb(url ?? 'postgres://unused')
  let scope: Scope
  const secrets = createSecrets('c'.repeat(64))
  const log = { info() {}, warn() {}, error() {} }
  const run = randomUUID().slice(0, 8)
  const appId = randomUUID()
  const channelId = `UC${run}`
  const env = { GOOGLE_OAUTH_CLIENT_ID: 'client.apps.googleusercontent.com', GOOGLE_OAUTH_CLIENT_SECRET: 'secret' }
  const calls: string[] = []

  /** Stands in for Google: the token endpoint, the Data API and the Analytics API. */
  const google = (options: { refreshToken?: boolean } = {}) =>
    (async (target: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const address = new URL(String(target))
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
      calls.push(`${address.hostname}${address.pathname}`)
      if (address.hostname === 'oauth2.googleapis.com') {
        const form = new URLSearchParams(String(init?.body))
        if (form.get('grant_type') === 'refresh_token') return json({ access_token: 'ya29.refreshed', expires_in: 3599 })
        return json({
          access_token: 'ya29.first',
          expires_in: 3599,
          ...(options.refreshToken === false ? {} : { refresh_token: '1//refresh' }),
          scope: 'https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/yt-analytics.readonly',
        })
      }
      if (address.pathname === '/youtube/v3/channels') {
        return json({
          items: [
            {
              id: channelId,
              snippet: { title: 'Habit Shorts', customUrl: `@habitshorts${run}` },
              statistics: { subscriberCount: '1520' },
              contentDetails: { relatedPlaylists: { uploads: `UU${run}` } },
            },
          ],
        })
      }
      if (address.pathname === '/youtube/v3/playlistItems') {
        return json({
          items: [
            { contentDetails: { videoId: `new-${run}`, videoPublishedAt: new Date(Date.now() - 2 * 86_400_000).toISOString() } },
            { contentDetails: { videoId: `old-${run}`, videoPublishedAt: '2020-01-01T00:00:00Z' } },
          ],
          nextPageToken: 'more',
        })
      }
      if (address.pathname === '/youtube/v3/videos') {
        return json({
          items: [
            {
              id: `new-${run}`,
              snippet: { title: 'My streak after 100 days', publishedAt: new Date(Date.now() - 2 * 86_400_000).toISOString() },
              statistics: { viewCount: '48200', likeCount: '3100', commentCount: '87' },
              contentDetails: { duration: 'PT45S' },
            },
          ],
        })
      }
      if (address.hostname === 'youtubeanalytics.googleapis.com') {
        return json({
          columnHeaders: [{ name: 'day' }, { name: 'views' }, { name: 'likes' }, { name: 'comments' }, { name: 'shares' }],
          rows: [
            ['2026-11-01', 1200, 80, 4, 9],
            ['2026-11-02', 3400, 210, 12, 30],
          ],
        })
      }
      return json({ error: { message: 'not found', errors: [{ reason: 'notFound' }] } }, 404)
    }) as typeof fetch

  beforeAll(async () => {
    await runMigrations({ db, sql })
    scope = await defaultScope(db)
    await db.insert(apps).values({ organizationId: scope.organizationId, id: appId, name: 'Habit Tube' })
  })

  afterAll(async () => {
    await db.delete(connections).where(and(eq(connections.provider, 'youtube'), eq(connections.externalAccountId, channelId)))
    await db.delete(assets).where(eq(assets.externalId, channelId))
    await db.delete(apps).where(and(eq(apps.organizationId, scope.organizationId), eq(apps.id, appId)))
    await sql.end({ timeout: 5 })
  })

  it('reads ISO durations', () => {
    expect(parseDuration('PT45S')).toBe(45)
    expect(parseDuration('PT1H2M3S')).toBe(3723)
    expect(parseDuration(undefined)).toBeNull()
  })

  it('needs a refresh token, so syncs outlive the hour-long access token', async () => {
    await expect(
      connectYouTube({ ...scope, secrets, env, fetch: google({ refreshToken: false }) }, { code: 'c', redirectUri: 'https://x/cb' }),
    ).rejects.toThrow(ConnectInputError)
  })

  it('saves the channel, with its tokens encrypted, waiting for an app', async () => {
    const result = await connectYouTube({ ...scope, secrets, env, fetch: google() }, { code: 'c', redirectUri: 'https://x/cb' })
    expect(result).toEqual({ channel: `@habitshorts${run}`, channelId })
    const [connection] = await db.select().from(connections).where(eq(connections.externalAccountId, channelId))
    expect(connection?.refreshTokenEnc).not.toContain('1//refresh')
    const [asset] = await db.select().from(assets).where(eq(assets.externalId, channelId))
    expect(asset).toMatchObject({ kind: 'youtube_channel', appId: null })
  })

  it('writes daily views and posts, refreshing an expired token first', async () => {
    const [asset] = await db.select().from(assets).where(eq(assets.externalId, channelId))
    await assignAsset(scope, { assetId: asset?.id ?? '', appId })
    // The stored access token has run out.
    await db.update(connections).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(connections.externalAccountId, channelId))

    const [app] = await db.select().from(apps).where(eq(apps.id, appId))
    const connector = createYouTubeConnector({ env, fetch: google() })
    expect(await connector.isConfigured(app!, scope)).toBe(true)
    calls.length = 0
    await connector.sync({ ...scope, app: app!, range: { from: '2026-11-01', to: '2026-11-02' }, log, secrets })
    expect(calls[0]).toBe('oauth2.googleapis.com/token')

    const views = await db
      .select({ date: metricDaily.date, value: metricDaily.value })
      .from(metricDaily)
      .where(and(eq(metricDaily.appId, appId), eq(metricDaily.source, 'youtube'), eq(metricDaily.metric, 'views')))
      .orderBy(metricDaily.date)
    expect(views).toEqual([
      { date: '2026-11-01', value: 1200 },
      { date: '2026-11-02', value: 3400 },
    ])
    const followers = await db
      .select({ value: metricDaily.value })
      .from(metricDaily)
      .where(and(eq(metricDaily.appId, appId), eq(metricDaily.metric, 'followers')))
    expect(followers).toEqual([{ value: 1520 }])

    // Only the video from the last year, with its totals.
    const saved = await db.select().from(posts).where(eq(posts.appId, appId))
    expect(saved).toMatchObject([
      { platform: 'youtube', externalId: `new-${run}`, views: 48200, likes: 3100, comments: 87, durationSeconds: 45 },
    ])
    const [connection] = await db.select().from(connections).where(eq(connections.externalAccountId, channelId))
    expect(connection?.status).toBe('ok')
    expect(connection?.expiresAt?.getTime()).toBeGreaterThan(Date.now())
  })
})
