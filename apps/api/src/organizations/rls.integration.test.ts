import { eq, inArray, sql as raw } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, type Db } from '../db/client.js'
import { runMigrations } from '../db/migrate.js'
import { apps, assets, connections, metricDaily, organization, postSnapshots, posts, reviews, syncRuns } from '../db/schema.js'
import { testDatabaseUrl } from '../test/database.js'
import { testOrganization } from '../test/organizations.js'
import type { Scope, Tx } from './scope.js'
import { TENANT_ROLE, TENANT_TABLES, rowLevelSecurityProblems, tenancyOf } from './tenancy.js'

/**
 * Row-level security on its own, under the code's filters: what a query sees and may write when
 * it forgets its organization filter, or points at another organization's rows. Every query here
 * leaves the filter out on purpose.
 */
const url = testDatabaseUrl()
const SLUGS = ['rls-a', 'rls-b']
/** A role that bypasses row-level security, for the boot check to refuse. Invented for tests. */
const BYPASSING_ROLE = 'apphq_test_bypass'
const OWNER_ROLE = 'apphq_test_owner'

interface Rows {
  app: string
  connection: string
  post: string
}

describe.skipIf(!url)('row-level security on the organization tables', () => {
  const { db, sql } = createDb(url ?? 'postgres://unused')
  let a: Scope
  let b: Scope
  let inA: Rows
  let inB: Rows

  /** One row in every organization table, written with the test login (which bypasses it). */
  async function fill(organizationId: string): Promise<Rows> {
    const [app] = await db.insert(apps).values({ organizationId, name: 'Kept apart' }).returning()
    const [connection] = await db
      .insert(connections)
      .values({ organizationId, provider: 'tiktok', externalAccountId: 'open-id-rls' })
      .returning()
    await db
      .insert(assets)
      .values({ organizationId, kind: 'tiktok_account', externalId: 'open-id-rls', name: '@rls', appId: app!.id, connectionId: connection!.id })
    await db.insert(metricDaily).values({ organizationId, appId: app!.id, date: '2026-10-01', source: 'tiktok', metric: 'views', value: 1 })
    const [post] = await db
      .insert(posts)
      .values({ organizationId, platform: 'tiktok', externalId: 'video-rls', appId: app!.id, connectionId: connection!.id, publishedAt: new Date('2026-10-01') })
      .returning()
    await db.insert(postSnapshots).values({ organizationId, postId: post!.id, date: '2026-10-01', views: 1, likes: 0, comments: 0, shares: 0 })
    await db
      .insert(reviews)
      .values({ organizationId, appId: app!.id, store: 'app_store', externalId: 'review-rls', rating: 5, createdAt: new Date('2026-10-01') })
    await db.insert(syncRuns).values({ organizationId, source: 'tiktok', appId: app!.id, status: 'ok' })
    return { app: app!.id, connection: connection!.id, post: post!.id }
  }

  async function wipe() {
    const ids = (await db.select({ id: organization.id }).from(organization).where(inArray(organization.slug, SLUGS))).map((row) => row.id)
    if (ids.length === 0) return
    await db.delete(syncRuns).where(inArray(syncRuns.organizationId, ids))
    await db.delete(assets).where(inArray(assets.organizationId, ids))
    await db.delete(apps).where(inArray(apps.organizationId, ids))
    await db.delete(connections).where(inArray(connections.organizationId, ids))
    await db.delete(organization).where(inArray(organization.id, ids))
  }

  /** A transaction as the tenant role, with an organization set or none. */
  function asTenant<T>(organizationId: string | null, work: (tx: Tx) => Promise<T>): Promise<T> {
    return db.transaction(async (tx) => {
      await tx.execute(raw`select set_config('role', ${TENANT_ROLE}, true)`)
      if (organizationId) await tx.execute(raw`select set_config('app.organization_id', ${organizationId}, true)`)
      return work(tx)
    })
  }

  /** The organization of every row of a table this transaction can see, with no filter at all. */
  async function visible(tx: Tx, table: string): Promise<string[]> {
    const rows = await tx.execute<{ organization_id: string }>(raw.raw(`select organization_id from ${table}`))
    return rows.map((row) => row.organization_id)
  }

  /** The error a statement fails with, or null. A savepoint keeps the transaction usable. */
  async function failure(tx: Tx, statement: (tx: Tx) => Promise<unknown>): Promise<string | null> {
    try {
      await tx.transaction(async (inner) => {
        await statement(inner)
      })
      return null
    } catch (err) {
      const cause = (err as { cause?: { message?: string } }).cause
      return cause?.message ?? (err instanceof Error ? err.message : String(err))
    }
  }

  beforeAll(async () => {
    await runMigrations({ db, sql })
    await wipe()
    a = await testOrganization(db, 'rls-a')
    b = await testOrganization(db, 'rls-b')
    inA = await fill(a.organizationId)
    inB = await fill(b.organizationId)
    await db.execute(
      raw.raw(`
        do $$ begin
          create role ${BYPASSING_ROLE} nologin bypassrls;
        exception when duplicate_object or unique_violation then null;
        end $$`),
    )
    await db.execute(
      raw.raw(`
        do $$ begin
          create role ${OWNER_ROLE} nologin;
        exception when duplicate_object or unique_violation then null;
        end $$`),
    )
  })

  afterAll(async () => {
    await wipe()
    await db.execute(raw.raw(`drop role if exists ${BYPASSING_ROLE}`)).catch(() => undefined)
    await db.execute(raw.raw(`drop role if exists ${OWNER_ROLE}`)).catch(() => undefined)
    await sql.end()
  })

  it('this database runs units of work as the tenant role', async () => {
    expect(await tenancyOf(db)).toEqual({ role: TENANT_ROLE })
  })

  it('with no organization set, a bare select on every organization table returns nothing', async () => {
    await asTenant(null, async (tx) => {
      for (const table of TENANT_TABLES) expect(await visible(tx, table), table).toEqual([])
    })
  })

  it('a connection that ran a unit of work before still sees nothing without one, and does not fail', async () => {
    const reserved = await sql.reserve()
    try {
      // The setting reads as '' once the transaction that set it has ended, not as null.
      await reserved`begin`
      await reserved`select set_config('app.organization_id', ${a.organizationId}, true)`
      await reserved`commit`
      await reserved`begin`
      await reserved`select set_config('role', ${TENANT_ROLE}, true)`
      const rows = await reserved`select count(*)::int as n from apps`
      await reserved`commit`
      expect(rows[0]?.n).toBe(0)
    } finally {
      reserved.release()
    }
  })

  it("with organization A set, every organization table shows only A's rows", async () => {
    await a.run(async (tx) => {
      for (const table of TENANT_TABLES) {
        const seen = await visible(tx, table)
        expect(seen.length, table).toBeGreaterThan(0)
        expect(new Set(seen), table).toEqual(new Set([a.organizationId]))
      }
    })
  })

  it("B's rows can't be changed or deleted from A, even by id", async () => {
    await a.run(async (tx) => {
      expect(await tx.update(apps).set({ name: 'Taken' }).where(eq(apps.id, inB.app)).returning()).toEqual([])
      expect(await tx.delete(posts).where(eq(posts.id, inB.post)).returning()).toEqual([])
      expect(await tx.delete(connections).where(eq(connections.id, inB.connection)).returning()).toEqual([])
    })
    const [still] = await db.select().from(apps).where(eq(apps.id, inB.app))
    expect(still?.name).toBe('Kept apart')
  })

  it("an insert or update into B's organization fails in A", async () => {
    const rls = /row-level security/
    await a.run(async (tx) => {
      expect(await failure(tx, (t) => t.insert(apps).values({ organizationId: b.organizationId, name: 'Planted' }))).toMatch(rls)
      expect(
        await failure(tx, (t) => t.insert(connections).values({ organizationId: b.organizationId, provider: 'tiktok', externalAccountId: 'planted' })),
      ).toMatch(rls)
      expect(
        await failure(tx, (t) =>
          t.insert(metricDaily).values({ organizationId: b.organizationId, appId: inB.app, date: '2026-10-02', source: 'tiktok', metric: 'views', value: 9 }),
        ),
      ).toMatch(rls)
      expect(
        await failure(tx, (t) => t.insert(syncRuns).values({ organizationId: b.organizationId, source: 'tiktok', status: 'ok' })),
      ).toMatch(rls)
      // Moving A's own row into B.
      expect(await failure(tx, (t) => t.update(apps).set({ organizationId: b.organizationId }).where(eq(apps.id, inA.app)))).toMatch(rls)
      expect(
        await failure(tx, (t) => t.update(reviews).set({ organizationId: b.organizationId }).where(eq(reviews.appId, inA.app))),
      ).toMatch(rls)
    })
  })

  it("a write in A that points at B's app, account or post fails", async () => {
    const rls = /row-level security/
    const org = a.organizationId
    await a.run(async (tx) => {
      expect(
        await failure(tx, (t) => t.insert(metricDaily).values({ organizationId: org, appId: inB.app, date: '2026-10-02', source: 'tiktok', metric: 'views', value: 9 })),
      ).toMatch(rls)
      expect(
        await failure(tx, (t) =>
          t.insert(reviews).values({ organizationId: org, appId: inB.app, store: 'app_store', externalId: 'planted', rating: 1, createdAt: new Date() }),
        ),
      ).toMatch(rls)
      expect(await failure(tx, (t) => t.insert(syncRuns).values({ organizationId: org, source: 'tiktok', appId: inB.app, status: 'ok' }))).toMatch(rls)
      expect(
        await failure(tx, (t) =>
          t.insert(posts).values({ organizationId: org, platform: 'tiktok', externalId: 'planted', appId: inB.app, publishedAt: new Date() }),
        ),
      ).toMatch(rls)
      expect(
        await failure(tx, (t) =>
          t.insert(posts).values({ organizationId: org, platform: 'tiktok', externalId: 'planted', appId: inA.app, connectionId: inB.connection, publishedAt: new Date() }),
        ),
      ).toMatch(rls)
      expect(
        await failure(tx, (t) =>
          t.insert(postSnapshots).values({ organizationId: org, postId: inB.post, date: '2026-10-02', views: 1, likes: 0, comments: 0, shares: 0 }),
        ),
      ).toMatch(rls)
      expect(await failure(tx, (t) => t.update(assets).set({ appId: inB.app }).where(eq(assets.organizationId, org)))).toMatch(rls)
      expect(await failure(tx, (t) => t.update(assets).set({ connectionId: inB.connection }).where(eq(assets.organizationId, org)))).toMatch(rls)
      // Its own app, account and post are fine.
      expect(
        await failure(tx, (t) => t.insert(metricDaily).values({ organizationId: org, appId: inA.app, date: '2026-10-02', source: 'tiktok', metric: 'views', value: 9 })),
      ).toBeNull()
      expect(
        await failure(tx, (t) =>
          t.insert(postSnapshots).values({ organizationId: org, postId: inA.post, date: '2026-10-02', views: 1, likes: 0, comments: 0, shares: 0 }),
        ),
      ).toBeNull()
    })
  })

  it("the tenant role can't reach tables that hold no organization's data", async () => {
    await asTenant(a.organizationId, async (tx) => {
      expect(await failure(tx, (t) => t.execute(raw`select count(*) from "user"`))).toMatch(/permission denied/)
      expect(await failure(tx, (t) => t.execute(raw`select count(*) from "session"`))).toMatch(/permission denied/)
      expect(await failure(tx, (t) => t.execute(raw`select count(*) from organization`))).toMatch(/permission denied/)
    })
  })

  it('a table owner without bypass is held to the policies too (how a host without roles runs)', async () => {
    // Rolled back: the owner changes only inside this transaction.
    const rollback = new Error('rollback')
    const seen = await db
      .transaction(async (tx) => {
        await tx.execute(raw.raw(`alter table apps owner to ${OWNER_ROLE}`))
        await tx.execute(raw`select set_config('role', ${OWNER_ROLE}, true)`)
        const none = await visible(tx, 'apps')
        await tx.execute(raw`select set_config('app.organization_id', ${a.organizationId}, true)`)
        const own = await visible(tx, 'apps')
        throw Object.assign(rollback, { seen: { none, own } })
      })
      .catch((err: unknown) => {
        if (err !== rollback) throw err
        return (err as typeof rollback & { seen: { none: string[]; own: string[] } }).seen
      })
    expect(seen.none).toEqual([])
    expect(new Set(seen.own)).toEqual(new Set([a.organizationId]))
  })

  it('the boot check passes here, and refuses a role that bypasses row-level security', async () => {
    expect(await rowLevelSecurityProblems(db)).toEqual([])
    expect((await rowLevelSecurityProblems(db, { role: BYPASSING_ROLE })).join('\n')).toMatch(/BYPASSRLS/)
  })

  it('the boot check refuses a table whose owner is not held to its policies', async () => {
    const rollback = new Error('rollback')
    const problems = await db
      .transaction(async (tx) => {
        await tx.execute(raw`alter table sync_runs no force row level security`)
        // A nested transaction is a savepoint, so the check sees the change.
        const found = await rowLevelSecurityProblems(tx as unknown as Db)
        throw Object.assign(rollback, { found })
      })
      .catch((err: unknown) => {
        if (err !== rollback) throw err
        return (err as typeof rollback & { found: string[] }).found
      })
    expect(problems.join('\n')).toMatch(/not forced on "sync_runs"/)
  })
})
