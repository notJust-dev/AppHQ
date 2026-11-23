import { randomBytes, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createSecrets } from '../lib/crypto.js'
import { seedDemo } from '../seed/demo.js'
import { testDatabaseUrl } from '../test/database.js'
import { createDb } from './client.js'
import { CopyRefusedError, copyDatabase } from './copy.js'
import { runMigrations } from './migrate.js'
import { connections, syncRuns } from './schema.js'

// Runs only when a database is provided: TEST_DATABASE_URL=postgres://.../appdashboard_test.
// Creates throwaway databases next to it, so its user needs CREATEDB.
const url = testDatabaseUrl()

describe.skipIf(!url)('Copying the database into a new app', () => {
  const admin = createDb(url ?? 'postgres://unused')
  const suffix = randomUUID().slice(0, 8)
  const urlOf = (name: string) => {
    const next = new URL(url ?? 'postgres://unused')
    next.pathname = `/${name}`
    return next.toString()
  }
  const open = (name: string) => ({ name, ...createDb(urlOf(name)) })
  const source = open(`copy_source_${suffix}_test`)
  const target = open(`copy_target_${suffix}_test`)
  const wrongKey = open(`copy_wrongkey_${suffix}_test`)
  const behind = open(`copy_behind_${suffix}_test`)
  const databases = [source, target, wrongKey, behind]
  const key = randomBytes(32).toString('hex')
  const secrets = createSecrets(key)

  beforeAll(async () => {
    for (const { name } of databases) await admin.sql.unsafe(`create database "${name}"`)
    for (const db of databases) await runMigrations(db)

    await seedDemo(source.db, { days: 30, endDate: '2026-11-20' })
    await source.db.insert(connections).values({
      provider: 'tiktok',
      externalAccountId: `copy-${suffix}`,
      displayName: '@copytest',
      accessTokenEnc: secrets.encrypt('access-token'),
      details: { note: 'json survives' },
    })
    await source.db.insert(syncRuns).values([
      { source: 'tiktok', status: 'ok', rowsWritten: 3 },
      { source: 'app_store', status: 'error', error: 'line one\nline two\ttabbed' },
    ])
    // A database one migration behind the others.
    await behind.sql`delete from drizzle.__drizzle_migrations where id = (select max(id) from drizzle.__drizzle_migrations)`
  }, 60_000)

  afterAll(async () => {
    for (const db of databases) await db.sql.end({ timeout: 5 })
    for (const { name } of databases) await admin.sql.unsafe(`drop database if exists "${name}"`)
    await admin.sql.end({ timeout: 5 })
  })

  it('copies every table with the same rows, and the copied credentials open', async () => {
    const result = await copyDatabase(target.sql, urlOf(source.name), secrets)

    expect(result.credentialsReadable).toBe(true)
    const counts = Object.fromEntries(result.tables.map((table) => [table.table, table.copied]))
    expect(counts.apps).toBeGreaterThan(1)
    expect(counts.metric_daily).toBeGreaterThan(100)
    expect(counts.connections).toBe(1)
    expect(counts.sync_runs).toBe(2)
    for (const table of result.tables) expect(table.copied).toBe(table.source)
    // Parents come before the tables that refer to them.
    const order = result.tables.map((table) => table.table)
    expect(order.indexOf('apps')).toBeLessThan(order.indexOf('metric_daily'))
    expect(order.indexOf('posts')).toBeLessThan(order.indexOf('post_snapshots'))

    // The rows are the same, text with tabs and new lines and JSON included.
    const dump = (sql: typeof source.sql) =>
      Promise.all([
        sql`select * from apps order by id`,
        sql`select * from connections order by id`,
        sql`select * from sync_runs order by id`,
        sql`select app_id, date, source, metric, dimension, value from metric_daily order by 1, 2, 3, 4, 5`,
      ])
    expect(await dump(target.sql)).toEqual(await dump(source.sql))
  })

  it('carries on numbering after the copied ids', async () => {
    const [copiedMax] = await target.sql<{ id: number }[]>`select max(id)::int as id from sync_runs`
    const [added] = await target.db.insert(syncRuns).values({ source: 'tiktok', status: 'ok' }).returning()
    expect(added?.id).toBeGreaterThan(copiedMax?.id ?? 0)
  })

  it('refuses to copy into a database that already has data, and changes nothing', async () => {
    const before = await target.sql`select count(*)::int as n from sync_runs`
    await expect(copyDatabase(target.sql, urlOf(source.name), secrets)).rejects.toBeInstanceOf(CopyRefusedError)
    expect(await target.sql`select count(*)::int as n from sync_runs`).toEqual(before)
  })

  it('says when this API cannot open the copied credentials', async () => {
    const other = createSecrets(randomBytes(32).toString('hex'))
    const result = await copyDatabase(wrongKey.sql, urlOf(source.name), other)
    expect(result.credentialsReadable).toBe(false)
  })

  it('refuses when the two databases have not run the same migrations', async () => {
    await expect(copyDatabase(behind.sql, urlOf(source.name), secrets)).rejects.toThrow(/same migrations/)
  })
})
