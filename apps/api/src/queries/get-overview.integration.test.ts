import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '../db/client.js'
import { runMigrations } from '../db/migrate.js'
import { apps } from '../db/schema.js'
import { upsertMetrics } from '../metrics/upsert.js'
import { testDatabaseUrl } from '../test/database.js'
import { getOverview } from './get-overview.js'

// Runs only when a database is provided: TEST_DATABASE_URL=postgres://.../appdashboard_test
const url = testDatabaseUrl()

describe.skipIf(!url)('Portfolio overview, against a real database', () => {
  const { db, sql } = createDb(url ?? 'postgres://unused')
  const appId = `overview-${randomUUID().slice(0, 8)}`
  const range = { from: '2026-11-10', to: '2026-11-12' }

  beforeAll(async () => {
    await runMigrations({ db, sql })
    await db.insert(apps).values({ id: appId, name: 'Overview Test' })
    // The App Store reports every day, including one with no downloads; nothing else reports.
    await upsertMetrics(db, [
      { appId, date: '2026-11-10', source: 'app_store', metric: 'downloads', value: 0 },
      { appId, date: '2026-11-11', source: 'app_store', metric: 'downloads', value: 5 },
    ])
  })

  afterAll(async () => {
    await db.delete(apps).where(eq(apps.id, appId))
    await sql.end({ timeout: 5 })
  })

  it('tells a metric nobody reported from one that was reported as zero', async () => {
    const overview = await getOverview.handler({ db }, range)
    const app = overview.apps.find((entry) => entry.app.id === appId)

    expect(app?.totals).toEqual({ downloads: 5, revenue: 0, socialViews: 0 })
    expect(app?.reporting).toEqual({ downloads: true, revenue: false, socialViews: false })
    expect(overview.reporting.downloads).toBe(true)
  })

  it('counts a day reported as zero as reported', async () => {
    const overview = await getOverview.handler({ db }, { from: '2026-11-10', to: '2026-11-10' })
    const app = overview.apps.find((entry) => entry.app.id === appId)

    expect(app?.totals.downloads).toBe(0)
    expect(app?.reporting.downloads).toBe(true)
  })
})
