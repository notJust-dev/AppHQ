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
    await sql`insert into apps (id, name) values ('kicks', 'Kicks'), ('zen', 'Zen')`
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

  it('keeps the values and links: the portfolio row, assets on their apps, numbers', async () => {
    expect(await sql`select id, kind from apps order by id`).toEqual([
      { id: 'kicks', kind: 'app' },
      { id: 'portfolio', kind: 'portfolio' },
      { id: 'zen', kind: 'app' },
    ])
    expect(await sql`select external_id, app_id from assets order by external_id`).toEqual([
      { external_id: '1000000001', app_id: 'kicks' },
      { external_id: 'com.example.waiting', app_id: null },
      { external_id: 'ig-1', app_id: 'portfolio' },
      { external_id: 'open-id-1', app_id: 'kicks' },
    ])
    const [sum] = await sql`select sum(value)::float as total from metric_daily`
    expect(sum?.total).toBeCloseTo(12 + 15 + 9.99 + 300)
  })

  it('lets a second organization reuse the same app slug and external ids, and nothing points across', async () => {
    const [other] = await sql<{ id: string }[]>`insert into organization (name, slug) values ('Other', 'other') returning id`
    await sql`insert into apps (organization_id, id, name) values (${other!.id}, 'kicks', 'Their Kicks'), (${other!.id}, 'portfolio', 'Shared accounts')`
    await sql`insert into connections (organization_id, provider, external_account_id) values (${other!.id}, 'tiktok', 'open-id-1')`
    await sql`insert into assets (organization_id, kind, external_id, name, app_id) values (${other!.id}, 'tiktok_account', 'open-id-1', 'x', 'kicks')`
    await sql`insert into posts (organization_id, platform, external_id, app_id, published_at) values (${other!.id}, 'tiktok', 'video-1', 'kicks', now())`
    await sql`insert into reviews (organization_id, app_id, store, external_id, rating, created_at) values (${other!.id}, 'kicks', 'app_store', 'review-1', 1, now())`

    // A row can't point at another organization's app.
    await expect(
      sql`insert into metric_daily (organization_id, app_id, date, source, metric, value) values (${other!.id}, 'zen', '2026-10-01', 'x', 'y', 1)`,
    ).rejects.toThrow(/foreign key/)

    // Nor can a snapshot belong to another organization's post.
    const [theirsNot] = await sql<{ id: string }[]>`select id from posts where organization_id <> ${other!.id}`
    await expect(
      sql`insert into post_snapshots (organization_id, post_id, date, views, likes, comments, shares) values (${other!.id}, ${theirsNot!.id}, '2026-10-02', 1, 0, 0, 0)`,
    ).rejects.toThrow(/foreign key/)

    // An app with linked assets can't be deleted (removeApp unlinks them first).
    await expect(sql`delete from apps where organization_id = ${other!.id} and id = 'kicks'`).rejects.toThrow(/foreign key/)
    // Removing one organization's app takes its posts and reviews, and leaves the other's alone.
    await sql`update assets set app_id = null where organization_id = ${other!.id}`
    await sql`delete from apps where organization_id = ${other!.id} and id = 'kicks'`
    const [first] = await sql<{ id: string }[]>`select id from organization where slug = 'default'`
    expect(await sql`select organization_id from posts`).toEqual([{ organization_id: first!.id }])
    expect(await sql`select organization_id from reviews`).toEqual([{ organization_id: first!.id }])
    const [kept] = await sql`select count(*)::int as n from metric_daily where organization_id = ${first!.id} and app_id = 'kicks'`
    expect(kept?.n).toBe(2)
  })

  it('refuses to delete an organization that still holds data', async () => {
    await expect(sql`delete from organization where slug = 'default'`).rejects.toThrow(/foreign key/)
  })
})
