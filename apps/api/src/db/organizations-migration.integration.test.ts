import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testDatabaseUrl } from '../test/database.js'
import { createDb } from './client.js'
import { runMigrations } from './migrate.js'

/**
 * Migration 0011 on a database in the shape before it, with rows in it: everything that existed
 * must land in the one organization it makes, nothing lost and nothing changed. Runs on its own
 * throwaway database (made and dropped here), on the server TEST_DATABASE_URL points at.
 */
const url = testDatabaseUrl()

const TABLES = ['apps', 'connections', 'assets', 'metric_daily', 'posts', 'post_snapshots', 'reviews', 'sync_runs'] as const

describe.skipIf(!url)('migration 0011: one organization holds everything that was there', () => {
  const server = new URL(url ?? 'postgres://unused/x_test')
  const name = `organizations_migration_${process.pid}_test`
  const admin = postgres(url ?? '', { max: 1, onnotice: () => {} })
  const target = new URL(server)
  target.pathname = `/${name}`
  const { db, sql } = createDb(target.toString())
  const before = mkdtempSync(join(tmpdir(), 'apphq-migrations-'))
  const counts: Record<string, number> = {}

  beforeAll(async () => {
    await admin.unsafe(`drop database if exists "${name}"`)
    await admin.unsafe(`create database "${name}"`)

    // The migrations as they were before organizations: 0000 to 0010.
    const folder = fileURLToPath(new URL('../../drizzle', import.meta.url))
    cpSync(folder, before, { recursive: true })
    const journalPath = join(before, 'meta', '_journal.json')
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { idx: number; tag: string }[] }
    journal.entries = journal.entries.filter((entry) => entry.idx <= 10)
    expect(journal.entries.at(-1)?.tag).toBe('0010_accounts')
    writeFileSync(journalPath, JSON.stringify(journal))
    await migrate(db, { migrationsFolder: before })

    // Rows in the old shape: no organization anywhere. Invented values only.
    await sql`insert into apps (id, name) values ('kicks', 'Kicks'), ('zen', 'Zen'), ('demo-trailmate', 'Trailmate')`
    const [conn] = await sql<{ id: string }[]>`
      insert into connections (provider, external_account_id, display_name)
      values ('tiktok', 'open-id-1', '@kicks.app') returning id`
    await sql`insert into connections (provider, external_account_id) values ('app_store', '12345678')`
    await sql`
      insert into assets (kind, external_id, name, app_id, connection_id) values
        ('tiktok_account', 'open-id-1', '@kicks.app', 'kicks', ${conn!.id}),
        ('ios_app', '1000000001', 'Kicks', 'kicks', null),
        ('instagram_account', 'ig-1', '@shared', 'portfolio', null),
        ('android_app', 'com.example.waiting', 'Waiting', null, null)`
    await sql`
      insert into metric_daily (app_id, date, source, metric, value) values
        ('kicks', '2026-10-01', 'app_store', 'downloads', 12),
        ('kicks', '2026-10-02', 'app_store', 'downloads', 15),
        ('zen', '2026-10-01', 'revenuecat', 'revenue', 9.99),
        ('portfolio', '2026-10-01', 'instagram', 'views', 300)`
    const [post] = await sql<{ id: string }[]>`
      insert into posts (platform, external_id, app_id, connection_id, published_at, views)
      values ('tiktok', 'video-1', 'kicks', ${conn!.id}, '2026-10-01T12:00:00Z', 500) returning id`
    await sql`insert into post_snapshots (post_id, date, views, likes, comments, shares) values (${post!.id}, '2026-10-01', 500, 5, 1, 0)`
    await sql`
      insert into reviews (app_id, store, external_id, rating, created_at)
      values ('kicks', 'app_store', 'review-1', 5, '2026-10-01T00:00:00Z')`
    await sql`
      insert into sync_runs (source, app_id, status) values ('tiktok', 'kicks', 'ok'), ('scheduled', null, 'ok')`
    await sql`insert into waitlist (email) values ('someone@example.com')`
    await sql`insert into "user" (name, email, email_verified) values ('Test Person', 'person@example.com', true)`

    for (const table of [...TABLES, 'waitlist', 'user']) {
      const [row] = await sql.unsafe<{ n: number }[]>(`select count(*)::int as n from "${table}"`)
      counts[table] = row!.n
    }

    // What the API does when it boots.
    await runMigrations({ db, sql })
  })

  afterAll(async () => {
    await sql.end()
    await admin.unsafe(`drop database if exists "${name}"`)
    await admin.end()
    rmSync(before, { recursive: true, force: true })
  })

  it('makes exactly one organization, with a neutral name and slug', async () => {
    const rows = await sql`select name, slug from organization`
    expect(rows).toEqual([{ name: 'Default organization', slug: 'default' }])
  })

  it.each(TABLES)('puts every row of %s in it, and keeps them all', async (table) => {
    const [org] = await sql<{ id: string }[]>`select id from organization`
    const [row] = await sql.unsafe<{ n: number; inside: number }[]>(
      `select count(*)::int as n, count(*) filter (where organization_id = $1)::int as inside from "${table}"`,
      [org!.id],
    )
    expect(row).toEqual({ n: counts[table], inside: counts[table] })
    const [column] = await sql<{ is_nullable: string }[]>`
      select is_nullable from information_schema.columns where table_name = ${table} and column_name = 'organization_id'`
    expect(column?.is_nullable).toBe('NO')
  })

  it('leaves the tables that belong to no organization as they were', async () => {
    for (const table of ['waitlist', 'user']) {
      const [row] = await sql.unsafe<{ n: number }[]>(`select count(*)::int as n from "${table}"`)
      expect(row?.n).toBe(counts[table])
    }
    const [snapshot] = await sql`select views from post_snapshots`
    expect(snapshot?.views).toBe('500')
  })

  it('gives every app a uuid and keeps it linked: the portfolio row, demo apps, assets, numbers', async () => {
    const appRows = await sql<{ id: string; name: string; kind: string; demo: boolean }[]>`select id, name, kind, demo from apps order by name`
    expect(appRows.map(({ name, kind, demo }) => ({ name, kind, demo }))).toEqual([
      { name: 'Kicks', kind: 'app', demo: false },
      { name: 'Shared accounts', kind: 'portfolio', demo: false },
      { name: 'Trailmate', kind: 'app', demo: true },
      { name: 'Zen', kind: 'app', demo: false },
    ])
    for (const app of appRows) expect(app.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(new Set(appRows.map((app) => app.id)).size).toBe(appRows.length)

    // Every link points at the same app as before, through its new id.
    expect(
      await sql`select a.external_id, apps.name from assets a left join apps on apps.id = a.app_id order by a.external_id`,
    ).toEqual([
      { external_id: '1000000001', name: 'Kicks' },
      { external_id: 'com.example.waiting', name: null },
      { external_id: 'ig-1', name: 'Shared accounts' },
      { external_id: 'open-id-1', name: 'Kicks' },
    ])
    expect(
      await sql`select apps.name, sum(m.value)::float as total from metric_daily m join apps on apps.id = m.app_id group by apps.name order by apps.name`,
    ).toEqual([
      { name: 'Kicks', total: 27 },
      { name: 'Shared accounts', total: 300 },
      { name: 'Zen', total: 9.99 },
    ])
    expect(await sql`select apps.name from posts p join apps on apps.id = p.app_id`).toEqual([{ name: 'Kicks' }])
    expect(await sql`select apps.name from reviews r join apps on apps.id = r.app_id`).toEqual([{ name: 'Kicks' }])
    expect(await sql`select s.source, apps.name from sync_runs s left join apps on apps.id = s.app_id order by s.source`).toEqual([
      { source: 'scheduled', name: null },
      { source: 'tiktok', name: 'Kicks' },
    ])
  })

  it('lets a second organization reuse app names and external ids, with one portfolio each', async () => {
    const [other] = await sql<{ id: string }[]>`insert into organization (name, slug) values ('Other', 'other') returning id`
    const [theirKicks] = await sql<{ id: string }[]>`insert into apps (organization_id, name) values (${other!.id}, 'Kicks') returning id`
    await sql`insert into apps (organization_id, name, kind) values (${other!.id}, 'Shared accounts', 'portfolio')`
    await expect(
      sql`insert into apps (organization_id, name, kind) values (${other!.id}, 'Another portfolio', 'portfolio')`,
    ).rejects.toThrow(/apps_org_portfolio_idx/)
    await sql`insert into connections (organization_id, provider, external_account_id) values (${other!.id}, 'tiktok', 'open-id-1')`
    await sql`insert into assets (organization_id, kind, external_id, name, app_id) values (${other!.id}, 'tiktok_account', 'open-id-1', 'x', ${theirKicks!.id})`
    await sql`insert into posts (organization_id, platform, external_id, app_id, published_at) values (${other!.id}, 'tiktok', 'video-1', ${theirKicks!.id}, now())`
    await sql`insert into reviews (organization_id, app_id, store, external_id, rating, created_at) values (${other!.id}, ${theirKicks!.id}, 'app_store', 'review-1', 1, now())`

    // Removing their app takes its posts and reviews, keeps its asset without an app, and leaves
    // the first organization's alone.
    await sql`delete from apps where id = ${theirKicks!.id}`
    const [first] = await sql<{ id: string }[]>`select id from organization where slug = 'default'`
    expect(await sql`select organization_id from posts`).toEqual([{ organization_id: first!.id }])
    expect(await sql`select organization_id from reviews`).toEqual([{ organization_id: first!.id }])
    expect(await sql`select app_id from assets where organization_id = ${other!.id}`).toEqual([{ app_id: null }])
    const [kept] = await sql`select count(*)::int as n from metric_daily where organization_id = ${first!.id}`
    expect(kept?.n).toBe(counts.metric_daily)
  })

  it('refuses to delete an organization that still holds data', async () => {
    await expect(sql`delete from organization where slug = 'default'`).rejects.toThrow(/foreign key/)
  })
})
