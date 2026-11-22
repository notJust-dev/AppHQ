import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRevenueCatConnector } from '../connectors/revenuecat/connector.js'
import { createDb } from '../db/client.js'
import { runMigrations } from '../db/migrate.js'
import { apps, assets, connections, metricDaily } from '../db/schema.js'
import { assetOf, connectionOf } from '../test/assets.js'
import { createSecrets } from '../lib/crypto.js'
import { testDatabaseUrl } from '../test/database.js'
import { connectRevenueCat } from './connect-revenuecat.js'
import { assignAsset } from '../assets/store.js'

// Runs only when a database is provided: TEST_DATABASE_URL=postgres://.../appdashboard_test
const url = testDatabaseUrl()

describe.skipIf(!url)('RevenueCat, against a real database', () => {
  const { db, sql } = createDb(url ?? 'postgres://unused')
  const secrets = createSecrets('c'.repeat(64))
  const projectId = `proj_${randomUUID().slice(0, 8)}`
  const log = { info() {}, warn() {}, error() {} }
  const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 1000

  /** Stands in for RevenueCat. `reject` makes every chart request fail like a revoked key. */
  const revenueCat = (options: { reject?: boolean } = {}) =>
    (async (input: Parameters<typeof fetch>[0]) => {
      const { pathname } = new URL(String(input))
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

      if (pathname === '/v2/projects') {
        return json({ items: [{ id: projectId, name: 'Integration Test App' }] })
      }
      if (pathname === `/v2/projects/${projectId}/apps`) {
        return json({
          items: [
            { id: 'a1', type: 'app_store', app_store: { bundle_id: 'dev.example.app' } },
            { id: 'a2', type: 'play_store', play_store: { package_name: 'dev.example.app' } },
          ],
        })
      }
      if (pathname.includes('/charts/')) {
        if (options.reject) return json({ type: 'authentication_error', message: 'revoked' }, 401)
        const isRevenue = pathname.endsWith('/charts/revenue')
        return json({
          measures: isRevenue
            ? [{ display_name: 'Transactions' }, { display_name: 'Revenue' }]
            : [{ display_name: 'Value' }],
          values: isRevenue
            ? [
                { cohort: day('2026-11-18'), measure: 0, value: 3 },
                { cohort: day('2026-11-18'), measure: 1, value: 20.5 },
                { cohort: day('2026-11-19'), measure: 1, value: 30 },
              ]
            : [{ cohort: day('2026-11-19'), measure: 0, value: 7 }],
        })
      }
      return json({ type: 'resource_missing', message: pathname }, 404)
    }) as typeof fetch

  let appId = ''

  beforeAll(async () => {
    await runMigrations({ db, sql })
  })

  afterAll(async () => {
    if (appId) await db.delete(apps).where(eq(apps.id, appId))
    await db.delete(assets).where(eq(assets.externalId, projectId))
    await db.delete(connections).where(eq(connections.externalAccountId, projectId))
    await sql.end({ timeout: 5 })
  })

  it('finds the project without adding an app, and stores the key encrypted', async () => {
    const [connected] = await connectRevenueCat({ db, secrets, fetch: revenueCat() }, 'sk_live_key')

    // Nothing in the dashboard names this bundle id, so the project waits on the Apps page.
    expect(connected).toEqual({ name: 'Integration Test App', appId: null, appName: null })
    const project = await assetOf(db, 'revenuecat_project', projectId)
    expect(project).toMatchObject({
      appId: null,
      details: { bundleId: 'dev.example.app', androidPackage: 'dev.example.app' },
    })

    const connection = await connectionOf(db, 'revenuecat_project', projectId)
    expect(connection?.accessTokenEnc).not.toContain('sk_live_key')
    expect(secrets.decrypt(connection?.accessTokenEnc ?? '')).toBe('sk_live_key')
  })

  it('adds the app when the person picks it, and keeps it when the key is replaced', async () => {
    const project = await assetOf(db, 'revenuecat_project', projectId)
    appId = (await assignAsset(db, { assetId: project.id, appId: 'new' })).appId ?? ''
    expect(appId).not.toBe('')

    const [again] = await connectRevenueCat({ db, secrets, fetch: revenueCat() }, 'sk_new_key')

    expect(again).toEqual({ name: 'Integration Test App', appId, appName: 'Integration Test App' })
    const rows = await db.select().from(connections).where(eq(connections.externalAccountId, projectId))
    expect(rows).toHaveLength(1)
    expect(secrets.decrypt(rows[0]?.accessTokenEnc ?? '')).toBe('sk_new_key')
  })

  it('syncs the charts into metric_daily, reading revenue by name', async () => {
    const connector = createRevenueCatConnector({ fetch: revenueCat() })
    const [app] = await db.select().from(apps).where(eq(apps.id, appId))
    if (!app) throw new Error('app missing')

    expect(await connector.isConfigured(app, db)).toBe(true)
    const range = { from: '2026-11-01', to: '2026-11-19' }
    const first = await connector.sync({ db, app, range, log, secrets })
    // Running it again must not duplicate anything.
    await connector.sync({ db, app, range, log, secrets })

    const revenue = await db
      .select({ date: metricDaily.date, value: metricDaily.value })
      .from(metricDaily)
      .where(and(eq(metricDaily.appId, appId), eq(metricDaily.metric, 'revenue')))
      .orderBy(metricDaily.date)
    expect(revenue).toEqual([
      { date: '2026-11-18', value: 20.5 },
      { date: '2026-11-19', value: 30 },
    ])
    // Two revenue days, plus one point for each of the other five charts.
    expect(first.rowsWritten).toBe(7)

    const connection = await connectionOf(db, 'revenuecat_project', projectId)
    expect(connection?.status).toBe('ok')
    expect(connection?.lastSyncedAt).toBeInstanceOf(Date)
  })

  it('marks the connection for re-authorisation when the key is rejected', async () => {
    const connector = createRevenueCatConnector({ fetch: revenueCat({ reject: true }) })
    const [app] = await db.select().from(apps).where(eq(apps.id, appId))
    if (!app) throw new Error('app missing')

    await expect(
      connector.sync({ db, app, range: { from: '2026-11-01', to: '2026-11-19' }, log, secrets }),
    ).rejects.toThrow(/6 of 6 charts failed/)

    const connection = await connectionOf(db, 'revenuecat_project', projectId)
    expect(connection?.status).toBe('needs_reauth')
  })

  it('refuses to connect when no encryption key is configured', async () => {
    await expect(
      connectRevenueCat({ db, secrets: createSecrets(undefined), fetch: revenueCat() }, 'sk_x'),
    ).rejects.toThrow(/ENCRYPTION_KEY/)
  })
})
