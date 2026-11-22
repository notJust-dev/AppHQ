import { randomUUID } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { pacificMidnight } from '../connectors/meta/days.js'
import { createFacebookConnector } from '../connectors/meta/facebook-connector.js'
import { createInstagramConnector } from '../connectors/meta/instagram-connector.js'
import { createDb } from '../db/client.js'
import { runMigrations } from '../db/migrate.js'
import { apps, connections, metricDaily, posts } from '../db/schema.js'
import { createSecrets } from '../lib/crypto.js'
import { addDays, eachDay } from '../lib/dates.js'
import { listAccounts } from '../queries/list-accounts.js'
import { listMetaAccounts } from '../queries/list-meta-accounts.js'
import { testDatabaseUrl } from '../test/database.js'
import { ConnectInputError } from './connect-app-store.js'
import { assignMetaAccount, connectMeta } from './connect-meta.js'

// Runs only when a database is provided: TEST_DATABASE_URL=postgres://.../appdashboard_test
const url = testDatabaseUrl()

const env = {
  META_APP_ID: 'app1',
  META_APP_SECRET: 'secret1',
  META_LOGIN_CONFIG_ID: 'cfg1',
  META_GRAPH_URL: 'https://graph.test',
} as NodeJS.ProcessEnv

const metaTime = (seconds: number) => new Date(seconds * 1000).toISOString().replace('.000Z', '+0000')

/**
 * Stands in for the Graph API: two Pages, one with a linked Instagram account. Instagram
 * refuses the Page token (as Meta may), so the connector has to fall back to the user token.
 */
function fakeMeta(suffix: string) {
  const ids = { pageA: `pa-${suffix}`, pageB: `pb-${suffix}`, ig: `ig-${suffix}`, igOnly: `io-${suffix}` }
  const state = { userTokenWorks: true, pageTokensWork: true, igTokensUsed: [] as string[] }
  const DAILY: Record<string, number> = {
    page_media_view: 100,
    page_total_media_view_unique: 80,
    page_post_engagements: 10,
    page_follows: 1000,
  }

  const impl = (async (input: Parameters<typeof fetch>[0]) => {
    const { pathname, searchParams: q } = new URL(String(input))
    const path = pathname.replace(/^\/v27\.0/, '')
    const token = q.get('access_token') ?? ''
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
    const expired = () => json({ error: { message: 'Session has expired', code: 190, error_subcode: 463 } }, 400)

    if (path === '/oauth/access_token') {
      if (q.get('code') === 'good-code') return json({ access_token: 'short-1', expires_in: 3600 })
      if (q.get('fb_exchange_token') === 'short-1') return json({ access_token: 'user-long', expires_in: 5_183_944 })
      // Unified login: a system-user token with no expiry, which cannot be swapped.
      if (q.get('code') === 'unified-code') return json({ access_token: 'suat-1', token_type: 'bearer' })
      return json({ error: { message: 'Invalid verification code format.', code: 100 } }, 400)
    }
    if (token === 'suat-1') {
      if (path === '/me/accounts') return json({ error: { message: 'Missing permission', code: 200 } }, 403)
      if (path === '/me/assigned_instagram_accounts') {
        return json({ data: [{ id: ids.igOnly, username: 'quillnote.app' }] })
      }
    }
    if (path === '/me/accounts') {
      return json({
        data: [
          { id: ids.pageA, name: 'TinyKicks', access_token: 'page-A', instagram_business_account: { id: ids.ig, username: 'tinykicks.app' } },
          { id: ids.pageB, name: 'Other Page', access_token: 'page-B' },
        ],
      })
    }

    // Instagram: the Page token is refused, the user token works until it expires.
    if (path.startsWith(`/${ids.ig}`) || path.startsWith('/m-')) {
      state.igTokensUsed.push(token)
      if (token === 'page-A') return json({ error: { message: 'Insufficient permission', code: 10 } }, 403)
      if (!state.userTokenWorks) return expired()
      if (path === `/${ids.ig}`) return json({ id: ids.ig, username: 'tinykicks.app', followers_count: 300 })
      if (path === `/${ids.ig}/insights`) return json({ data: [{ name: 'views', total_value: { value: 50 } }] })
      if (path === `/${ids.ig}/media`) {
        return json({
          data: [
            { id: 'm-1', caption: 'Reel one', media_product_type: 'REELS', permalink: 'https://ig/1', timestamp: '2026-11-11T18:00:00+0000', like_count: 40, comments_count: 3 },
            { id: 'm-2', caption: 'Old post', media_product_type: 'FEED', permalink: 'https://ig/2', timestamp: '2026-06-01T18:00:00+0000', like_count: 9, comments_count: 1 },
          ],
        })
      }
      if (path.endsWith('/insights')) {
        return json({ data: [{ name: 'views', values: [{ value: path.includes('m-1') ? 7000 : 400 }] }, { name: 'shares', values: [{ value: 12 }] }] })
      }
    }

    if (!state.pageTokensWork) return expired()
    if (path === `/${ids.pageA}/insights`) {
      const metric = q.get('metric') ?? ''
      const since = Number(q.get('since'))
      const until = Number(q.get('until'))
      const values = eachDay({ from: '2026-01-01', to: '2026-12-31' })
        .map((day) => pacificMidnight(addDays(day, 1)))
        .filter((end) => end > since && end <= until)
        .map((end) => ({ value: DAILY[metric] ?? 0, end_time: metaTime(end) }))
      return json({ data: [{ name: metric, period: 'day', values }] })
    }
    if (path === `/${ids.pageA}/published_posts`) {
      return json({
        data: [
          {
            id: `${ids.pageA}_1`,
            created_time: '2026-11-11T16:00:00+0000',
            message: 'Kick counting tip',
            permalink_url: 'https://fb/post/1',
            reactions: { summary: { total_count: 33 } },
            comments: { summary: { total_count: 4 } },
            shares: { count: 2 },
          },
        ],
      })
    }
    if (path === `/${ids.pageA}/video_reels`) {
      return json({ data: [{ id: `v-${suffix}`, created_time: '2026-11-12T16:00:00+0000', description: 'A reel', permalink_url: '/reel/1' }] })
    }
    if (path === `/${ids.pageA}_1/insights`) return json({ data: [{ name: 'post_media_view', values: [{ value: 500 }] }] })
    if (path === `/v-${suffix}/video_insights`) return json({ data: [{ name: 'blue_reels_play_count', values: [{ value: 900 }] }] })
    return json({ error: { message: `unknown path ${path}`, code: 803 } }, 404)
  }) as typeof fetch

  return { ids, state, impl }
}

describe.skipIf(!url)('Facebook and Instagram, against a real database', () => {
  const { db, sql } = createDb(url ?? 'postgres://unused')
  const secrets = createSecrets('e'.repeat(64))
  const log = { info() {}, warn() {}, error() {} }
  const suffix = randomUUID().slice(0, 8)
  const appId = `meta-${suffix}`
  const meta = fakeMeta(suffix)
  const at = (iso: string) => () => new Date(iso)
  const range = { from: '2026-11-10', to: '2026-11-12' }
  const redirectUri = 'https://dash.example/connect/meta/callback'

  const row = async (externalAccountId: string) => {
    const [found] = await db.select().from(connections).where(eq(connections.externalAccountId, externalAccountId))
    if (!found) throw new Error(`no connection ${externalAccountId}`)
    return found
  }
  const app = async () => {
    const [found] = await db.select().from(apps).where(eq(apps.id, appId))
    if (!found) throw new Error('app missing')
    return found
  }
  const metric = (source: string, name: string) =>
    db
      .select({ date: metricDaily.date, value: metricDaily.value })
      .from(metricDaily)
      .where(and(eq(metricDaily.appId, appId), eq(metricDaily.source, source), eq(metricDaily.metric, name)))
      .orderBy(metricDaily.date)

  beforeAll(async () => {
    await runMigrations({ db, sql })
    await db.insert(apps).values({ id: appId, name: 'Meta Test App' })
  })

  afterAll(async () => {
    await db.delete(apps).where(eq(apps.id, appId))
    await db
      .delete(connections)
      .where(
        inArray(connections.externalAccountId, [meta.ids.pageA, meta.ids.pageB, meta.ids.ig, meta.ids.igOnly]),
      )
    await sql.end({ timeout: 5 })
  })

  it('saves every Page and linked Instagram account, unassigned, with tokens encrypted', async () => {
    const result = await connectMeta({ db, secrets, env, fetch: meta.impl }, { code: 'good-code', redirectUri })
    expect(result).toMatchObject({ pages: 2, instagram: 1 })

    const page = await row(meta.ids.pageA)
    const ig = await row(meta.ids.ig)
    expect(page).toMatchObject({ provider: 'facebook', appId: null, displayName: 'TinyKicks', expiresAt: null })
    expect(secrets.decrypt(page.accessTokenEnc ?? '')).toBe('page-A')
    expect(ig).toMatchObject({ provider: 'instagram', appId: null, displayName: '@tinykicks.app' })
    expect(secrets.decrypt(ig.refreshTokenEnc ?? '')).toBe('user-long')
    expect(ig.expiresAt?.getTime()).toBeGreaterThan(Date.now() + 59 * 86_400_000)

    const listed = await listMetaAccounts.handler({ db })
    expect(listed.filter((a) => [meta.ids.pageA, meta.ids.pageB, meta.ids.ig].includes(a.id) || a.displayName === 'Other Page').length).toBeGreaterThan(0)
    const accountWide = await listAccounts.handler({ db })
    expect(accountWide.some((a) => a.provider === 'facebook' || a.provider === 'instagram')).toBe(false)
  })

  it('connects with Unified login: a lasting token and an Instagram account without a Page', async () => {
    const result = await connectMeta({ db, secrets, env, fetch: meta.impl }, { code: 'unified-code', redirectUri })
    expect(result).toEqual({ pages: 0, instagram: 1, expiresAt: null })

    const ig = await row(meta.ids.igOnly)
    expect(ig).toMatchObject({ provider: 'instagram', displayName: '@quillnote.app', expiresAt: null })
    expect(secrets.decrypt(ig.accessTokenEnc ?? '')).toBe('suat-1')
    expect(secrets.decrypt(ig.refreshTokenEnc ?? '')).toBe('suat-1')
  })

  it('assigns accounts to an app and keeps that through a reconnect', async () => {
    for (const id of [meta.ids.pageA, meta.ids.ig]) {
      await assignMetaAccount(db, { connectionId: (await row(id)).id, appId })
    }
    await expect(
      assignMetaAccount(db, { connectionId: (await row(meta.ids.pageB)).id, appId: 'no-such-app' }),
    ).rejects.toBeInstanceOf(ConnectInputError)

    await connectMeta({ db, secrets, env, fetch: meta.impl }, { code: 'good-code', redirectUri })
    expect((await row(meta.ids.pageA)).appId).toBe(appId)
    expect((await row(meta.ids.pageB)).appId).toBeNull()
  })

  it('reads Page insights onto Pacific days, and posts and reels with their views', async () => {
    const connector = createFacebookConnector({ fetch: meta.impl, env, now: at('2026-11-13T12:00:00Z') })
    expect(await connector.isConfigured(await app(), db)).toBe(true)
    await connector.sync({ db, app: await app(), range, log, secrets })

    expect(await metric('facebook', 'views')).toEqual([
      { date: '2026-11-10', value: 100 },
      { date: '2026-11-11', value: 100 },
      { date: '2026-11-12', value: 100 },
    ])
    expect((await metric('facebook', 'followers')).at(-1)).toEqual({ date: '2026-11-12', value: 1000 })

    const saved = await db
      .select({ caption: posts.caption, views: posts.views, likes: posts.likes, comments: posts.comments })
      .from(posts)
      .where(and(eq(posts.appId, appId), eq(posts.platform, 'facebook')))
      .orderBy(posts.publishedAt)
    expect(saved).toEqual([
      { caption: 'Kick counting tip', views: 500, likes: 33, comments: 4 },
      { caption: 'A reel', views: 900, likes: 0, comments: 0 },
    ])
    expect((await row(meta.ids.pageA)).status).toBe('ok')
  })

  it('reads Instagram day by day, falling back to the user token when the Page token is refused', async () => {
    const connector = createInstagramConnector({ fetch: meta.impl, env, now: at('2026-11-13T12:00:00Z') })
    await connector.sync({ db, app: await app(), range, log, secrets })

    expect(await metric('instagram', 'views')).toEqual([
      { date: '2026-11-10', value: 50 },
      { date: '2026-11-11', value: 50 },
      { date: '2026-11-12', value: 50 },
    ])
    expect(await metric('instagram', 'followers')).toEqual([{ date: '2026-11-13', value: 300 }])
    // After the first refusal the connector stays on the token that works.
    expect(meta.state.igTokensUsed.filter((t) => t === 'page-A')).toHaveLength(1)

    const saved = await db
      .select({ caption: posts.caption, views: posts.views, likes: posts.likes, shares: posts.shares })
      .from(posts)
      .where(and(eq(posts.appId, appId), eq(posts.platform, 'instagram')))
      .orderBy(posts.publishedAt)
    expect(saved).toEqual([
      { caption: 'Old post', views: 400, likes: 9, shares: 12 },
      { caption: 'Reel one', views: 7000, likes: 40, shares: 12 },
    ])
  })

  it('asks for a new sign-in when both Instagram tokens are refused', async () => {
    meta.state.userTokenWorks = false
    const connector = createInstagramConnector({ fetch: meta.impl, env, now: at('2026-11-14T12:00:00Z') })
    await expect(
      connector.sync({ db, app: await app(), range: { from: '2026-11-13', to: '2026-11-13' }, log, secrets }),
    ).rejects.toThrow(/1 of 1 Instagram accounts failed/)
    expect((await row(meta.ids.ig)).status).toBe('needs_reauth')
    // Facebook is unaffected: Page tokens do not expire with the sign-in.
    expect((await row(meta.ids.pageA)).status).toBe('ok')
  })
})
