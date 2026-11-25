import { and, asc, eq, inArray, sql as raw } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../app.js'
import { assignAsset, autoLink, createApp, removeApp, renameApp, setIgnored, upsertAssets } from '../assets/store.js'
import type { AccountConnector, AppConnector } from '../connectors/types.js'
import { createDb } from '../db/client.js'
import { runMigrations } from '../db/migrate.js'
import { apps, assets, connections, metricDaily, organization, postSnapshots, posts, reviews, syncRuns } from '../db/schema.js'
import { createSecrets } from '../lib/crypto.js'
import type { Logger } from '../lib/logger.js'
import { upsertMetrics } from '../metrics/upsert.js'
import { savePosts } from '../posts/save.js'
import { getAppFlow } from '../queries/get-app-flow.js'
import { getAppTimeline } from '../queries/get-app-timeline.js'
import { getOverview } from '../queries/get-overview.js'
import { getSyncStatus } from '../queries/get-sync-status.js'
import { listAccounts } from '../queries/list-accounts.js'
import { listApps } from '../queries/list-apps.js'
import { listAssets } from '../queries/list-assets.js'
import { listPosts } from '../queries/list-posts.js'
import {
  getMonetisationPerformance,
  getSearchPerformance,
  getSocialPerformance,
  getStorePerformance,
} from '../queries/performance.js'
import { getReviewSummary, listReviews } from '../queries/reviews.js'
import { markReviews, saveReviews } from '../reviews/save.js'
import { clearDemo, seedDemo } from '../seed/demo.js'
import { runSync } from '../sync/runner.js'
import { SCHEDULED, syncDueOrganizations } from '../sync/schedule.js'
import { TOKEN } from '../test/auth.js'
import { testDatabaseUrl } from '../test/database.js'
import { testOrganization } from '../test/organizations.js'
import { ACCESS_HEADER, DASHBOARD_ACCESS } from '../trpc/init.js'
import type { Scope } from './scope.js'

/**
 * Two organizations holding the same data: the same app slugs (the portfolio row included), the
 * same store, social and RevenueCat ids, the same post and review ids. Whatever one of them reads
 * or writes, through a query, a helper, a procedure or a sync, the other's rows stay exactly as
 * they were, and its reads don't change.
 */
const url = testDatabaseUrl()
const quiet: Logger = { info: () => {}, warn: () => {}, error: () => {} }
const SLUGS = ['isolation-a', 'isolation-b', 'isolation-c']
const DEMO = { days: 30, endDate: '2026-10-31' } as const
const RANGE = { from: '2026-10-02', to: '2026-10-31' }

describe.skipIf(!url)('two organizations with the same data', () => {
  const { db, sql } = createDb(url ?? 'postgres://unused')
  let a: Scope
  let b: Scope

  /** Every row an organization has, in a fixed order, so two snapshots compare exactly. */
  async function snapshot({ organizationId }: Scope) {
    const postIds = (await db.select({ id: posts.id }).from(posts).where(eq(posts.organizationId, organizationId))).map((row) => row.id)
    return {
      apps: await db.select().from(apps).where(eq(apps.organizationId, organizationId)).orderBy(asc(apps.id)),
      connections: await db.select().from(connections).where(eq(connections.organizationId, organizationId)).orderBy(asc(connections.id)),
      assets: await db.select().from(assets).where(eq(assets.organizationId, organizationId)).orderBy(asc(assets.id)),
      metrics: await db
        .select()
        .from(metricDaily)
        .where(eq(metricDaily.organizationId, organizationId))
        .orderBy(asc(metricDaily.appId), asc(metricDaily.date), asc(metricDaily.source), asc(metricDaily.metric)),
      posts: await db.select().from(posts).where(eq(posts.organizationId, organizationId)).orderBy(asc(posts.id)),
      snapshots:
        postIds.length === 0
          ? []
          : await db.select().from(postSnapshots).where(inArray(postSnapshots.postId, postIds)).orderBy(asc(postSnapshots.postId), asc(postSnapshots.date)),
      reviews: await db.select().from(reviews).where(eq(reviews.organizationId, organizationId)).orderBy(asc(reviews.id)),
      syncRuns: await db.select().from(syncRuns).where(eq(syncRuns.organizationId, organizationId)).orderBy(asc(syncRuns.id)),
    }
  }

  const sorted = <T>(rows: T[]) => [...rows].sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y)))

  /** What every query says about an organization, with nothing that depends on the clock. */
  async function reads(scope: Scope) {
    const appId = 'demo-habitloop'
    const read = (value: unknown) =>
      JSON.parse(JSON.stringify(value, (key, v) => (/At$|^lastSynced|^updated|^startedAt|^finishedAt|^id$/.test(key) ? undefined : v)))
    const result = read({
      apps: await listApps.handler(scope, undefined),
      assets: await listAssets.handler(scope, undefined),
      accounts: await listAccounts.handler(scope, undefined),
      overview: await getOverview.handler(scope, RANGE),
      timeline: await getAppTimeline.handler(scope, { appId, ...RANGE }),
      flow: await getAppFlow.handler(scope, { appId, ...RANGE }),
      posts: await listPosts.handler(scope, { appId, ...RANGE, limit: 200 }),
      social: await getSocialPerformance.handler(scope, RANGE),
      store: await getStorePerformance.handler(scope, RANGE),
      monetisation: await getMonetisationPerformance.handler(scope, RANGE),
      search: await getSearchPerformance.handler(scope, RANGE),
      // Reviews with the same time are ordered by row id, which differs between organizations.
      reviews: (await listReviews.handler(scope, { limit: 100 })).reviews,
      reviewSummary: await getReviewSummary.handler(scope, {}),
      syncSources: (await getSyncStatus.handler(scope, undefined)).map((run) => [run.source, run.status, run.rowsWritten]),
    }) as { reviews: unknown[] }
    return { ...result, reviews: sorted(result.reviews) }
  }

  /** The same data in an organization: the demo apps, a portfolio row, one real-looking account. */
  async function fill(scope: Scope) {
    await db.insert(apps).values({ organizationId: scope.organizationId, id: 'portfolio', name: 'Shared accounts', kind: 'portfolio' })
    await seedDemo(scope, DEMO)
    const [connection] = await db
      .insert(connections)
      .values({ organizationId: scope.organizationId, provider: 'tiktok', externalAccountId: 'open-id-shared', displayName: '@shared' })
      .returning()
    await upsertAssets(scope, [
      { kind: 'tiktok_account', externalId: 'open-id-shared', name: '@shared', connectionId: connection!.id },
      { kind: 'android_app', externalId: 'com.example.waiting', name: 'Waiting', connectionId: connection!.id },
    ])
    await db.insert(syncRuns).values({ organizationId: scope.organizationId, source: 'tiktok', appId: 'demo-habitloop', status: 'ok', rowsWritten: 3 })
  }

  async function wipe() {
    const found = await db.select({ id: organization.id }).from(organization).where(inArray(organization.slug, SLUGS))
    const ids = found.map((row) => row.id)
    if (ids.length === 0) return
    await db.delete(syncRuns).where(inArray(syncRuns.organizationId, ids))
    await db.update(assets).set({ appId: null }).where(inArray(assets.organizationId, ids))
    await db.delete(apps).where(inArray(apps.organizationId, ids))
    await db.delete(assets).where(inArray(assets.organizationId, ids))
    await db.delete(connections).where(inArray(connections.organizationId, ids))
    await db.delete(organization).where(inArray(organization.id, ids))
  }

  let aAlone: unknown
  let bBefore: Awaited<ReturnType<typeof snapshot>>

  beforeAll(async () => {
    await runMigrations({ db, sql })
    await wipe()
    a = await testOrganization(db, 'isolation-a')
    b = await testOrganization(db, 'isolation-b')
    await fill(a)
    aAlone = await reads(a)
    await fill(b)
    bBefore = await snapshot(b)
  })

  afterAll(async () => {
    await wipe()
    await sql.end()
  })

  const bIsUntouched = async () => expect(await snapshot(b)).toEqual(bBefore)

  it('the two organizations really hold the same keys', async () => {
    const keys = async (scope: Scope) => ({
      apps: (await snapshot(scope)).apps.map((app) => app.id),
      posts: (await snapshot(scope)).posts.map((post) => `${post.platform}:${post.externalId}`).sort(),
      reviews: (await snapshot(scope)).reviews.map((review) => `${review.store}:${review.externalId}`).sort(),
      assets: (await snapshot(scope)).assets.map((asset) => `${asset.kind}:${asset.externalId}`).sort(),
    })
    const [inA, inB] = [await keys(a), await keys(b)]
    expect(inA).toEqual(inB)
    expect(inA.apps).toContain('portfolio')
    expect(inA.posts.length).toBeGreaterThan(10)
    expect(inA.reviews.length).toBeGreaterThan(5)
  })

  it("every query reads only its own organization: B's rows change nothing in A's answers", async () => {
    expect(await reads(a)).toEqual(aAlone)
    // And B, holding the same data, gets the same answers.
    expect(await reads(b)).toEqual(aAlone)
  })

  it('an app id or row id from the other organization is not found', async () => {
    const c = await testOrganization(db, 'isolation-c')
    expect(await getAppTimeline.handler(c, { appId: 'demo-habitloop', ...RANGE })).toBeNull()
    expect(await getAppFlow.handler(c, { appId: 'demo-habitloop', ...RANGE })).toBeNull()
    expect(await listApps.handler(c, undefined)).toEqual([])
    expect(await listReviews.handler(c, { limit: 10 })).toMatchObject({ reviews: [] })

    const [bAsset] = bBefore.assets
    await expect(assignAsset(c, { assetId: bAsset!.id, appId: null })).rejects.toThrow(/no longer connected/)
    await expect(setIgnored(c, [bAsset!.id], true)).rejects.toThrow(/no longer there/)
    await expect(renameApp(c, 'demo-habitloop', 'Taken')).rejects.toThrow(/no longer exists/)
    await expect(removeApp(c, 'demo-habitloop')).rejects.toThrow(/no longer exists/)
    expect(await markReviews(c, undefined, true, bBefore.reviews.map((review) => review.id))).toBe(0)
    await bIsUntouched()
  })

  it("the helpers write only in their organization, even on the other's keys", async () => {
    expect(await createApp(a, 'Kicks')).toBe('kicks')
    expect(await createApp(b, 'Kicks')).toBe('kicks')
    bBefore = await snapshot(b)

    await renameApp(a, 'demo-habitloop', 'Renamed in A')
    const aAssets = (await snapshot(a)).assets
    const waiting = aAssets.find((asset) => asset.externalId === 'com.example.waiting')!
    await assignAsset(a, { assetId: waiting.id, appId: 'kicks' })
    await setIgnored(a, [aAssets.find((asset) => asset.kind === 'tiktok_account' && asset.appId === null)!.id], true)
    await autoLink(a)
    await upsertAssets(a, [{ kind: 'ios_app', externalId: 'demo.demo-habitloop', name: 'Changed in A', connectionId: null }])
    await upsertMetrics(a, [{ appId: 'demo-habitloop', date: '2026-10-05', source: 'app_store', metric: 'downloads', value: 99_999 }])
    const [post] = (await snapshot(a)).posts
    await savePosts(
      a,
      [{ ...post!, url: null, caption: 'changed in A', connectionId: post!.connectionId!, views: 123_456 }],
      '2026-10-31',
    )
    const [review] = (await snapshot(a)).reviews
    await saveReviews(a, [{ ...review!, rating: 1, body: 'changed in A' }])
    await markReviews(a, undefined, true, (await snapshot(a)).reviews.map((row) => row.id))
    await removeApp(a, 'demo-trailmate')
    await bIsUntouched()

    expect((await snapshot(a)).apps.find((app) => app.id === 'demo-habitloop')?.name).toBe('Renamed in A')
    expect((await snapshot(a)).apps.some((app) => app.id === 'demo-trailmate')).toBe(false)
  })

  it('every dashboard procedure works in the organization of the context', async () => {
    const app = await buildApp({
      db,
      sql,
      secrets: createSecrets(undefined),
      pingDb: async () => 1,
      internalApiToken: TOKEN,
      dashboardOrganization: async () => a.organizationId,
      logLevel: 'silent',
    })
    const headers = { authorization: `Bearer ${TOKEN}`, [ACCESS_HEADER]: DASHBOARD_ACCESS }
    const query = async (path: string, input?: unknown) =>
      app.inject({ method: 'GET', url: `/trpc/${path}${input === undefined ? '' : `?input=${encodeURIComponent(JSON.stringify(input))}`}`, headers })
    const mutate = async (path: string, input: unknown) =>
      app.inject({ method: 'POST', url: `/trpc/${path}`, headers: { ...headers, 'content-type': 'application/json' }, payload: JSON.stringify(input) })
    const data = (res: { json(): unknown }) => (res.json() as { result: { data: unknown } }).result.data

    try {
      // Reads through the router are A's.
      const listed = data(await query('apps.list')) as { id: string; name: string }[]
      expect(listed.find((row) => row.id === 'demo-habitloop')?.name).toBe('Renamed in A')
      expect(listed.some((row) => row.id === 'demo-trailmate')).toBe(false)
      expect((await query('apps.timeline', { appId: 'demo-trailmate', ...RANGE })).statusCode).toBe(404)
      expect(data(await query('reviews.unreadCount'))).toEqual({ count: 0 })

      // Writes through the router land in A.
      expect(data(await mutate('apps.create', { name: 'Kicks' }))).toEqual({ appId: 'kicks-2' })
      expect((await mutate('apps.rename', { appId: 'kicks', name: 'Kicks in A' })).statusCode).toBe(200)
      expect((await mutate('apps.remove', { appId: 'kicks-2' })).statusCode).toBe(200)
      expect((await mutate('reviews.mark', { filters: {}, read: false })).statusCode).toBe(200)
      const bAsset = bBefore.assets.find((asset) => asset.kind === 'android_app')!
      expect((await mutate('assets.assign', { assetId: bAsset.id, appId: null })).statusCode).toBe(400)
      expect((await mutate('assets.ignore', { assetIds: [bAsset.id], ignored: true })).statusCode).toBe(400)
      expect(data(await mutate('reviews.mark', { ids: bBefore.reviews.slice(0, 3).map((row) => row.id), read: false }))).toEqual({ changed: 0 })
      expect((await mutate('demo.clear', {})).statusCode).toBe(200)
      expect((await mutate('demo.seed', { days: 5 })).statusCode).toBe(200)
      // A sign-in started in another organization does not finish here.
      const other = await mutate('tiktok.connect', { code: 'c', redirectUri: 'https://apphq.example.com/x', appId: 'kicks', organizationId: b.organizationId })
      expect(other.statusCode).toBe(400)
      expect(other.json()).toMatchObject({ error: { message: expect.stringMatching(/another organization/) } })
      await bIsUntouched()
    } finally {
      await app.close()
    }
  })

  it('a sync of one organization writes only there, on the same keys the other uses', async () => {
    const appWriter: AppConnector = {
      source: 'tiktok',
      scope: 'app',
      isConfigured: () => true,
      async sync(ctx) {
        await upsertMetrics(ctx, [{ appId: ctx.app.id, date: '2026-10-06', source: 'tiktok', metric: 'views', value: 1 }])
        return { rowsWritten: 1 }
      },
    }
    const accountWriter: AccountConnector = {
      source: 'app_store',
      scope: 'account',
      isConfigured: () => true,
      async sync(ctx) {
        // B's review as a store would send it again: same store and id, no row id of B's.
        const { id: _id, organizationId: _org, readAt: _read, fetchedAt: _fetched, ...reviewOf } = bBefore.reviews[0]!
        await saveReviews(ctx, [{ ...reviewOf, appId: ctx.apps.find((app) => app.kind === 'app')!.id, body: 'synced into A' }])
        await upsertAssets(ctx, [{ kind: 'tiktok_account', externalId: 'open-id-shared', name: 'synced into A', connectionId: null }])
        return { rowsWritten: 2 }
      },
    }
    const deps = { db, sql, log: quiet, secrets: createSecrets(undefined) }
    const summary = await runSync(deps, { organizationId: a.organizationId, connectors: [appWriter, accountWriter], range: RANGE })
    expect(summary).toMatchObject({ skipped: false, failed: 0 })
    expect(summary.ok).toBeGreaterThan(1)
    await bIsUntouched()
    const runs = await db.select().from(syncRuns).where(and(eq(syncRuns.organizationId, a.organizationId), eq(syncRuns.source, 'tiktok')))
    expect(runs.length).toBeGreaterThan(1)
  })

  it("one organization's sync lock does not hold up another's", async () => {
    const reserved = await sql.reserve()
    try {
      // B is busy: the lock its own sync would take.
      await reserved`select pg_advisory_lock(727001, hashtext(${b.organizationId}))`
      const deps = { db, sql, log: quiet, secrets: createSecrets(undefined) }
      expect(await runSync(deps, { organizationId: b.organizationId, connectors: [], range: RANGE })).toMatchObject({ skipped: true })
      expect(await runSync(deps, { organizationId: a.organizationId, connectors: [], range: RANGE })).toMatchObject({ skipped: false })
    } finally {
      await reserved`select pg_advisory_unlock(727001, hashtext(${b.organizationId}))`
      reserved.release()
    }
  })

  it('the schedule walks every organization, and a failure in one does not stop the next', async () => {
    await db.delete(syncRuns).where(and(inArray(syncRuns.organizationId, [a.organizationId, b.organizationId]), eq(syncRuns.source, SCHEDULED)))
    bBefore = await snapshot(b)
    const failsInA: AppConnector = {
      source: 'revenuecat',
      scope: 'app',
      isConfigured: () => true,
      async sync(ctx) {
        if (ctx.organizationId === a.organizationId) throw new Error('A is broken')
        await upsertMetrics(ctx, [{ appId: ctx.app.id, date: '2026-10-07', source: 'revenuecat', metric: 'revenue', value: 1 }])
        return { rowsWritten: 1 }
      },
    }
    const deps = { db, sql, log: quiet, secrets: createSecrets(undefined) }
    await syncDueOrganizations(deps, { connectors: [failsInA], intervalMs: 3_600_000 })

    const scheduled = async (scope: Scope) =>
      db.select().from(syncRuns).where(and(eq(syncRuns.organizationId, scope.organizationId), eq(syncRuns.source, SCHEDULED)))
    expect((await scheduled(a)).map((run) => run.status)).toEqual(['ok'])
    expect((await scheduled(b)).map((run) => run.status)).toEqual(['ok'])
    const failed = await db
      .select()
      .from(syncRuns)
      .where(and(eq(syncRuns.organizationId, a.organizationId), eq(syncRuns.source, 'revenuecat'), eq(syncRuns.status, 'error')))
    expect(failed.length).toBeGreaterThan(0)
    const written = await db
      .select({ n: raw<number>`count(*)::int` })
      .from(metricDaily)
      .where(and(eq(metricDaily.organizationId, b.organizationId), eq(metricDaily.date, '2026-10-07'), eq(metricDaily.source, 'revenuecat'), eq(metricDaily.metric, 'revenue'), eq(metricDaily.value, 1)))
    expect(written[0]?.n).toBeGreaterThan(0)
  })

  it('clearing demo data in one organization leaves the other its demo apps', async () => {
    const before = (await snapshot(b)).apps.length
    await clearDemo(a)
    expect((await snapshot(a)).apps.some((app) => app.id.startsWith('demo-'))).toBe(false)
    expect((await snapshot(b)).apps.length).toBe(before)
  })
})

