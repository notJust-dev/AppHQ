import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDb } from '../db/client.js'
import { runMigrations } from '../db/migrate.js'
import { syncRuns } from '../db/schema.js'
import { createSecrets } from '../lib/crypto.js'
import type { Logger } from '../lib/logger.js'
import { testDatabaseUrl } from '../test/database.js'
import { SCHEDULED, isDue, syncIfDue } from './schedule.js'

const HOUR = 3_600_000
const quiet: Logger = { info: () => {}, warn: () => {}, error: () => {} }

describe('isDue', () => {
  const now = new Date('2026-11-23T12:00:00Z')
  it('is due when nothing has run', () => expect(isDue(null, now, 3 * HOUR)).toBe(true))
  it('waits out the interval', () => {
    expect(isDue(new Date(now.getTime() - 2 * HOUR), now, 3 * HOUR)).toBe(false)
    expect(isDue(new Date(now.getTime() - 3 * HOUR), now, 3 * HOUR)).toBe(true)
  })
})

// Runs only when a database is provided: TEST_DATABASE_URL=postgres://.../appdashboard_test
const url = testDatabaseUrl()

describe.skipIf(!url)('syncIfDue, against a real database', () => {
  const { db, sql } = createDb(url ?? 'postgres://unused')
  const deps = { db, sql, log: quiet, secrets: createSecrets(undefined) }
  const clear = () => db.delete(syncRuns).where(eq(syncRuns.source, SCHEDULED))

  beforeAll(() => runMigrations({ db, sql }))
  beforeEach(clear)
  afterAll(async () => {
    await clear()
    await sql.end()
  })

  it('runs once, then waits for the interval, and the time survives a restart', async () => {
    const start = new Date()
    expect(await syncIfDue(deps, { connectors: [], intervalMs: 3 * HOUR, now: start })).toBe('ran')
    // Nothing in memory: a second call reads the last run from the database.
    expect(await syncIfDue(deps, { connectors: [], intervalMs: 3 * HOUR, now: new Date(start.getTime() + HOUR) })).toBe('not-due')
    expect(await syncIfDue(deps, { connectors: [], intervalMs: 3 * HOUR, now: new Date(Date.now() + 4 * HOUR) })).toBe('ran')

    const rows = await db.select().from(syncRuns).where(eq(syncRuns.source, SCHEDULED))
    expect(rows.map((row) => row.status)).toEqual(['ok', 'ok'])
  })

  it('does not count a run that failed, so the next check tries again', async () => {
    await db.insert(syncRuns).values({ source: SCHEDULED, status: 'error', error: 'Another sync was running' })
    expect(await syncIfDue(deps, { connectors: [], intervalMs: 3 * HOUR })).toBe('ran')
  })
})
