import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTikTokConnector } from '../connectors/tiktok/connector.js'
import { createDb } from '../db/client.js'
import { runMigrations } from '../db/migrate.js'
import { apps, assets, connections, metricDaily, postSnapshots, posts } from '../db/schema.js'
import { createSecrets } from '../lib/crypto.js'
import { listPosts } from '../queries/list-posts.js'
import { assetOf } from '../test/assets.js'
import { testDatabaseUrl } from '../test/database.js'
import { defaultScope, testOrganization } from '../test/organizations.js'
import type { Scope } from '../organizations/scope.js'
import { ConnectInputError } from './connect-app-store.js'
import { connectTikTok } from './connect-tiktok.js'
import { tiktokDailyFrom } from '../queries/tiktok-history.js'

// Runs only when a database is provided: TEST_DATABASE_URL=postgres://.../appdashboard_test
const url = testDatabaseUrl()

const env = {
  TIKTOK_CLIENT_KEY: 'ck_test',
  TIKTOK_CLIENT_SECRET: 'cs_test',
  TIKTOK_API_URL: 'https://tiktok.test',
} as NodeJS.ProcessEnv

/**
 * Stands in for TikTok: rotating refresh tokens (an old one stops working), two-hour access
 * tokens, and videos whose totals the test moves forward between "days".
 */
function fakeTikTok(openId: string) {
  const state = {
    scope: 'user.info.basic,user.info.profile,user.info.stats,video.list',
    refreshToken: 'rft.0',
    accessToken: 'act.0',
    issued: 0,
    revoked: [] as string[],
    rejectRefresh: false,
    followers: 1200,
    videos: [
      { id: `${openId}-v1`, create_time: Date.parse('2026-10-01T12:00:00Z') / 1000, view_count: 50_000 },
      { id: `${openId}-v2`, create_time: Date.parse('2026-11-01T12:00:00Z') / 1000, view_count: 8_000 },
    ],
  }

  const issue = () => {
    state.issued++
    state.accessToken = `act.${state.issued}`
    state.refreshToken = `rft.${state.issued}`
    return {
      access_token: state.accessToken,
      expires_in: 7200,
      refresh_token: state.refreshToken,
      refresh_expires_in: 15_552_000,
      open_id: openId,
      scope: state.scope,
      token_type: 'Bearer',
    }
  }

  const impl = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const { pathname, searchParams } = new URL(String(input))
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
    const ok = { code: 'ok', message: '', log_id: 'log' }

    if (pathname === '/v2/oauth/token/') {
      const form = new URLSearchParams(String(init?.body))
      if (form.get('client_secret') !== 'cs_test') return json({ error: 'invalid_client' }, 401)
      if (form.get('grant_type') === 'authorization_code') {
        if (form.get('code') !== 'good-code') return json({ error: 'invalid_grant' }, 400)
        return json(issue())
      }
      if (state.rejectRefresh || form.get('refresh_token') !== state.refreshToken) {
        return json({ error: 'invalid_grant', error_description: 'Refresh token is invalid.' }, 400)
      }
      return json(issue())
    }
    if (pathname === '/v2/oauth/revoke/') {
      state.revoked.push(new URLSearchParams(String(init?.body)).get('token') ?? '')
      return json({})
    }

    const auth = new Headers(init?.headers).get('authorization')
    if (auth !== `Bearer ${state.accessToken}`) {
      return json({ data: {}, error: { code: 'access_token_invalid', message: 'expired' } }, 401)
    }
    if (pathname === '/v2/user/info/') {
      const fields = searchParams.get('fields') ?? ''
      return json({
        data: {
          user: {
            open_id: openId,
            display_name: 'Tiny Kicks',
            ...(fields.includes('username') ? { username: 'tinykicks' } : {}),
            ...(fields.includes('follower_count') ? { follower_count: state.followers } : {}),
          },
        },
        error: ok,
      })
    }
    if (pathname === '/v2/video/list/') {
      return json({
        data: {
          videos: state.videos.map((v) => ({ ...v, title: '', video_description: `Video ${v.id}` })),
          cursor: 0,
          has_more: false,
        },
        error: ok,
      })
    }
    return json({ data: {}, error: { code: 'not_found', message: pathname } }, 404)
  }) as typeof fetch

  return { state, impl }
}

describe.skipIf(!url)('TikTok, against a real database', () => {
  const { db, sql } = createDb(url ?? 'postgres://unused')
  let scope: Scope
  const secrets = createSecrets('d'.repeat(64))
  /** The views the two videos had when the account was connected, on the days they went up. */
  const history = [
    { date: '2026-10-01', value: 50_000 },
    { date: '2026-11-01', value: 8_000 },
  ]
  const nonZero = (rows: { date: string; value: number }[]) => rows.filter((row) => row.value !== 0)
  const log = { info() {}, warn() {}, error() {} }
  const appId = randomUUID()
  const openId = `open-${randomUUID().slice(0, 8)}`
  const tiktok = fakeTikTok(openId)
  const at = (iso: string) => () => new Date(iso)
  const redirectUri = 'https://dash.example/connect/tiktok/callback'

  const app = async () => {
    const [row] = await db.select().from(apps).where(eq(apps.id, appId))
    if (!row) throw new Error('app missing')
    return row
  }
  const connection = async () => {
    const [row] = await db
      .select()
      .from(connections)
      .where(and(eq(connections.provider, 'tiktok'), eq(connections.externalAccountId, openId)))
    if (!row) throw new Error('connection missing')
    return row
  }
  const metric = (name: string) =>
    db
      .select({ date: metricDaily.date, value: metricDaily.value })
      .from(metricDaily)
      .where(and(eq(metricDaily.appId, appId), eq(metricDaily.source, 'tiktok'), eq(metricDaily.metric, name)))
      .orderBy(metricDaily.date)

  beforeAll(async () => {
    await runMigrations({ db, sql })
    scope = await defaultScope(db)
    await db.insert(apps).values({ organizationId: scope.organizationId, id: appId, name: 'TikTok Test App' })
  })

  afterAll(async () => {
    await db.delete(assets).where(eq(assets.externalId, openId))
    await db.delete(apps).where(and(eq(apps.organizationId, scope.organizationId), eq(apps.id, appId)))
    await db.delete(connections).where(eq(connections.externalAccountId, openId))
    await sql.end({ timeout: 5 })
  })

  it('refuses an account that did not grant access to its videos, and revokes the token', async () => {
    tiktok.state.scope = 'user.info.basic'
    await expect(
      connectTikTok({ ...scope, secrets, env, fetch: tiktok.impl }, { code: 'good-code', redirectUri, appId }),
    ).rejects.toBeInstanceOf(ConnectInputError)
    expect(tiktok.state.revoked).toEqual(['act.1'])
    tiktok.state.scope = 'user.info.basic,user.info.profile,user.info.stats,video.list'
  })

  it('stores the account against the app, with its tokens encrypted', async () => {
    const result = await connectTikTok(
      { ...scope, secrets, env, fetch: tiktok.impl },
      { code: 'good-code', redirectUri, appId },
    )
    expect(result).toEqual({ appId, appName: 'TikTok Test App', account: '@tinykicks' })

    const row = await connection()
    expect((await assetOf(db, 'tiktok_account', openId)).appId).toBe(appId)
    expect(row.accessTokenEnc).not.toContain('act.')
    expect(secrets.decrypt(row.refreshTokenEnc ?? '')).toBe(tiktok.state.refreshToken)
    expect(row.scopes).toContain('video.list')
    expect(row.refreshExpiresAt).toBeInstanceOf(Date)

    // Pretend it was connected on the morning of Nov 10, with a token that has since expired.
    await db
      .update(connections)
      .set({ createdAt: new Date('2026-11-10T08:00:00Z'), expiresAt: new Date('2026-11-10T10:00:00Z') })
      .where(eq(connections.id, row.id))
  })

  it('takes the first snapshot on the day it is connected, with each video on its post day', async () => {
    const connector = createTikTokConnector({ fetch: tiktok.impl, env, now: at('2026-11-10T09:00:00Z') })
    expect(await connector.isConfigured(await app(), scope)).toBe(true)

    await connector.sync({ ...scope, app: await app(), range: { from: '2026-11-04', to: '2026-11-10' }, log, secrets })

    const saved = await db.select().from(posts).where(eq(posts.appId, appId)).orderBy(posts.publishedAt)
    expect(saved.map((p) => [p.caption, p.views])).toEqual([
      [`Video ${openId}-v1`, 50_000],
      [`Video ${openId}-v2`, 8_000],
    ])
    // No daily gain yet, but the history is there: each video's views on the day it went up, and
    // zero on the days between with no post, through the connection day.
    const views = await metric('views')
    expect(nonZero(views)).toEqual(history)
    expect(views).toHaveLength(41)
    expect(views[1]).toEqual({ date: '2026-10-02', value: 0 })
    expect(await metric('followers')).toEqual([{ date: '2026-11-10', value: 1200 }])
    // Real daily views begin the day after the connection.
    expect(await tiktokDailyFrom(scope, appId)).toBe('2026-11-11')
  })

  it('refreshes the expired token, keeps the new refresh token, and derives the next day', async () => {
    tiktok.state.videos[0]!.view_count = 50_400
    tiktok.state.videos[1]!.view_count = 8_100
    tiktok.state.videos.push({
      id: `${openId}-v3`,
      create_time: Date.parse('2026-11-11T07:00:00Z') / 1000,
      view_count: 2_500,
    })
    const before = tiktok.state.refreshToken

    const connector = createTikTokConnector({ fetch: tiktok.impl, env, now: at('2026-11-11T21:00:00Z') })
    await connector.sync({ ...scope, app: await app(), range: { from: '2026-11-05', to: '2026-11-11' }, log, secrets })

    const row = await connection()
    expect(tiktok.state.refreshToken).not.toBe(before)
    expect(secrets.decrypt(row.refreshTokenEnc ?? '')).toBe(tiktok.state.refreshToken)
    expect(row.status).toBe('ok')
    expect(row.expiresAt).toEqual(new Date('2026-11-11T23:00:00Z'))

    // 400 + 100 of growth on the old videos, plus all 2,500 of the one posted that day.
    expect(nonZero(await metric('views'))).toEqual([...history, { date: '2026-11-11', value: 3_000 }])

    const snapshots = await db
      .select({ date: postSnapshots.date })
      .from(postSnapshots)
      .innerJoin(posts, eq(posts.id, postSnapshots.postId))
      .where(eq(posts.appId, appId))
    expect(snapshots).toHaveLength(5)
  })

  it('lists the posts of a range, newest first', async () => {
    const listed = await listPosts.handler(scope, { appId, from: '2026-11-01', to: '2026-11-30', limit: 50 })
    expect(listed.map((p) => p.views)).toEqual([2_500, 8_100])
    expect(listed[0]).toMatchObject({ platform: 'tiktok', publishedAt: '2026-11-11T07:00:00.000Z' })
  })

  it('asks for the account to be connected again when TikTok rejects the refresh token', async () => {
    tiktok.state.rejectRefresh = true
    const connector = createTikTokConnector({ fetch: tiktok.impl, env, now: at('2026-11-13T09:00:00Z') })

    await expect(
      connector.sync({ ...scope, app: await app(), range: { from: '2026-11-07', to: '2026-11-13' }, log, secrets }),
    ).rejects.toThrow(/1 of 1 TikTok accounts failed/)
    expect((await connection()).status).toBe('needs_reauth')
    // Days already derived stay; the days without a reading stay empty instead of turning to 0.
    const views = await metric('views')
    expect(nonZero(views)).toEqual([...history, { date: '2026-11-11', value: 3_000 }])
    expect(views.at(-1)?.date).toBe('2026-11-11')
  })
})

describe.skipIf(!url)('the same TikTok account in two organizations', () => {
  const { db, sql } = createDb(url ?? 'postgres://unused')
  const secrets = createSecrets('d'.repeat(64))
  const log = { info() {}, warn() {}, error() {} }
  // Each organization has its own app for the account; app ids are unique across organizations.
  const xAppId = randomUUID()
  const yAppId = randomUUID()
  const openId = `open-shared-${randomUUID().slice(0, 8)}`
  const redirectUri = 'https://dash.example/connect/tiktok/callback'
  const now = () => new Date('2026-11-10T09:00:00Z')
  let x: Scope
  let y: Scope
  const appIdIn = ({ organizationId }: Scope) => (organizationId === x.organizationId ? xAppId : yAppId)

  const rowsOf = async (scope: Scope) => {
    const { organizationId } = scope
    const appId = appIdIn(scope)
    return {
      connections: await db
        .select()
        .from(connections)
        .where(and(eq(connections.organizationId, organizationId), eq(connections.externalAccountId, openId))),
      assets: await db.select().from(assets).where(and(eq(assets.organizationId, organizationId), eq(assets.externalId, openId))),
      // Ordered, so that the same rows always compare equal.
      posts: await db
        .select()
        .from(posts)
        .where(and(eq(posts.organizationId, organizationId), eq(posts.appId, appId)))
        .orderBy(posts.externalId),
      metrics: await db
        .select()
        .from(metricDaily)
        .where(and(eq(metricDaily.organizationId, organizationId), eq(metricDaily.appId, appId)))
        .orderBy(metricDaily.date, metricDaily.source, metricDaily.metric, metricDaily.dimension),
    }
  }

  beforeAll(async () => {
    await runMigrations({ db, sql })
    x = await testOrganization(db, 'tiktok-x')
    y = await testOrganization(db, 'tiktok-y')
    // An app with the same name in both.
    await db.insert(apps).values([
      { organizationId: x.organizationId, id: xAppId, name: 'Kicks' },
      { organizationId: y.organizationId, id: yAppId, name: 'Kicks' },
    ])
  })
  afterAll(async () => {
    for (const scope of [x, y]) {
      await db.delete(assets).where(and(eq(assets.organizationId, scope.organizationId), eq(assets.externalId, openId)))
      await db.delete(apps).where(and(eq(apps.organizationId, scope.organizationId), eq(apps.id, appIdIn(scope))))
      await db.delete(connections).where(and(eq(connections.organizationId, scope.organizationId), eq(connections.externalAccountId, openId)))
    }
    await sql.end()
  })

  it('connects and syncs it in each without touching the other', async () => {
    const inX = fakeTikTok(openId)
    const inY = fakeTikTok(openId)
    await connectTikTok({ ...x, secrets, fetch: inX.impl, env }, { code: 'good-code', redirectUri, appId: xAppId })
    const yBefore = await rowsOf(y)
    expect(yBefore.connections).toHaveLength(0)

    const connector = createTikTokConnector({ fetch: inX.impl, env, now, sleep: async () => {} })
    const [xApp] = await db.select().from(apps).where(and(eq(apps.organizationId, x.organizationId), eq(apps.id, xAppId)))
    await connector.sync({ ...x, app: xApp!, range: { from: '2026-11-03', to: '2026-11-09' }, log, secrets })
    expect(await rowsOf(y)).toEqual(yBefore)

    await connectTikTok({ ...y, secrets, fetch: inY.impl, env }, { code: 'good-code', redirectUri, appId: yAppId })
    const xAfterSync = await rowsOf(x)
    const [yApp] = await db.select().from(apps).where(and(eq(apps.organizationId, y.organizationId), eq(apps.id, yAppId)))
    await createTikTokConnector({ fetch: inY.impl, env, now, sleep: async () => {} }).sync({
      ...y,
      app: yApp!,
      range: { from: '2026-11-03', to: '2026-11-09' },
      log,
      secrets,
    })
    // Y's connect and sync left X's rows exactly as they were.
    expect(await rowsOf(x)).toEqual(xAfterSync)

    const [inXRows, inYRows] = [await rowsOf(x), await rowsOf(y)]
    for (const [rows, appId] of [[inXRows, xAppId], [inYRows, yAppId]] as const) {
      expect(rows.connections).toHaveLength(1)
      expect(rows.assets).toMatchObject([{ appId }])
      expect(rows.posts.map((post) => post.externalId).sort()).toEqual([`${openId}-v1`, `${openId}-v2`])
    }
    // Two accounts, each with its own tokens and its own posts.
    expect(inXRows.connections[0]!.id).not.toBe(inYRows.connections[0]!.id)
    expect(inXRows.assets[0]!.connectionId).toBe(inXRows.connections[0]!.id)
    expect(inYRows.assets[0]!.connectionId).toBe(inYRows.connections[0]!.id)
    expect(inXRows.posts.every((post) => post.connectionId === inXRows.connections[0]!.id)).toBe(true)
  })
})
