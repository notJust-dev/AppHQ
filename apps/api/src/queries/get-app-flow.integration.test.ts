import { randomUUID } from 'node:crypto'
import { inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '../db/client.js'
import { runMigrations } from '../db/migrate.js'
import { apps } from '../db/schema.js'
import { upsertMetrics } from '../metrics/upsert.js'
import { testDatabaseUrl } from '../test/database.js'
import { getAppFlow } from './get-app-flow.js'

// Runs only when a database is provided: TEST_DATABASE_URL=postgres://.../appdashboard_test
const url = testDatabaseUrl()

describe.skipIf(!url)('App flow totals, against a real database', () => {
  const { db, sql } = createDb(url ?? 'postgres://unused')
  const suffix = randomUUID().slice(0, 8)
  const full = `flow-full-${suffix}`
  const bare = `flow-bare-${suffix}`
  const range = { from: '2026-10-02', to: '2026-10-04' }

  beforeAll(async () => {
    await runMigrations({ db, sql })
    await db.insert(apps).values([
      { id: full, name: 'Flow Full' },
      { id: bare, name: 'Flow Bare' },
    ])
    const metrics = []
    // The 1st and 5th fall outside the range.
    for (let day = 1; day <= 5; day++) {
      const date = `2026-10-0${day}`
      metrics.push(
        { appId: full, date, source: 'tiktok', metric: 'views', value: 1000 },
        { appId: full, date, source: 'instagram', metric: 'views', value: 200 },
        { appId: full, date, source: 'app_store', metric: 'downloads', value: 30 },
        { appId: full, date, source: 'google_play', metric: 'downloads', value: 10 },
        // Page views are not part of the flow.
        { appId: full, date, source: 'app_store', metric: 'page_views', value: 999 },
        { appId: full, date, source: 'revenuecat', metric: 'trials', value: 5 },
        { appId: full, date, source: 'revenuecat', metric: 'trial_conversions', value: 2 },
        { appId: full, date, source: 'revenuecat', metric: 'trial_expirations', value: 2 },
        { appId: full, date, source: 'revenuecat', metric: 'trials_pending', value: 1 },
        { appId: full, date, source: 'revenuecat', metric: 'direct_subs', value: 1 },
        { appId: bare, date, source: 'app_store', metric: 'downloads', value: 0 },
      )
    }
    await upsertMetrics(db, metrics)
  })

  afterAll(async () => {
    await db.delete(apps).where(inArray(apps.id, [full, bare]))
    await sql.end({ timeout: 5 })
  })

  it('sums each stage over the range, with views by platform and downloads by store', async () => {
    expect(await getAppFlow.handler({ db }, { appId: full, ...range })).toEqual({
      range,
      socialViews: { total: 3600, bySource: { tiktok: 3000, instagram: 600 } },
      downloads: { total: 120, bySource: { app_store: 90, google_play: 30 } },
      trials: 15,
      trialOutcomes: { converted: 6, expired: 6, running: 3 },
      directSubscriptions: 3,
    })
  })

  it('tells a stage nothing reported (null) from one that reported zero', async () => {
    expect(await getAppFlow.handler({ db }, { appId: bare, ...range })).toEqual({
      range,
      socialViews: { total: null, bySource: {} },
      downloads: { total: 0, bySource: { app_store: 0 } },
      trials: null,
      trialOutcomes: { converted: null, expired: null, running: null },
      directSubscriptions: null,
    })
  })

  it('knows no app it was not given', async () => {
    expect(await getAppFlow.handler({ db }, { appId: `missing-${suffix}`, ...range })).toBeNull()
  })
})
