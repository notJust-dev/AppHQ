import { randomUUID } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRevenueCatConnector } from '../connectors/revenuecat/connector.js'
import { createDb } from '../db/client.js'
import { runMigrations } from '../db/migrate.js'
import { apps, assets, connections, metricDaily } from '../db/schema.js'
import { assetOf, connectionOf } from '../test/assets.js'
import { createSecrets } from '../lib/crypto.js'
import { testDatabaseUrl } from '../test/database.js'
import { connectRevenueCat } from './connect-revenuecat.js'
import { assignAsset, createApp } from '../assets/store.js'
import { ConnectInputError } from './errors.js'

// Runs only when a database is provided: TEST_DATABASE_URL=postgres://.../appdashboard_test
const url = testDatabaseUrl()

describe.skipIf(!url)('RevenueCat, against a real database', () => {
  const { db, sql } = createDb(url ?? 'postgres://unused')
  const secrets = createSecrets('c'.repeat(64))
  const projectId = `proj_${randomUUID().slice(0, 8)}`
  const log = { info() {}, warn() {}, error() {} }
  const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 1000
  /** The first day each chart was asked for, by chart name. */
  const startDates: Record<string, string> = {}

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
        const chart = pathname.split('/').at(-1) ?? ''
        startDates[chart] = new URL(String(input)).searchParams.get('start_date') ?? ''
        if (chart === 'trial_conversion_rate') {
          // Counted by the day the trials started: 10 started, of which 4 converted so far.
          const measures = ['Trial Starts', 'Conversions', 'Expirations', 'Pending', 'Completed Trials', 'Conversion Rate']
          return json({
            measures: measures.map((display_name) => ({ display_name })),
            values: [10, 4, 5, 1, 9, 44.4].map((value, measure) => ({ cohort: day('2026-11-12'), measure, value })),
          })
        }
        if (chart === 'actives_new') {
          const measures = ['Trial Conversions', 'Intro Offers', 'Direct Subscriptions', 'Total Paid Subscriptions']
          return json({
            measures: measures.map((display_name) => ({ display_name })),
            values: [3, 0, 2, 5].map((value, measure) => ({ cohort: day('2026-11-19'), measure, value })),
          })
        }
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
    expect(connected).toEqual({ name: 'Integration Test App', appId: null, appName: null, movedFrom: null, replaced: null })
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

    expect(again).toEqual({ name: 'Integration Test App', appId, appName: 'Integration Test App', movedFrom: null, replaced: null })
    const rows = await db.select().from(connections).where(eq(connections.externalAccountId, projectId))
    expect(rows).toHaveLength(1)
    expect(secrets.decrypt(rows[0]?.accessTokenEnc ?? '')).toBe('sk_new_key')
  })

  it("goes to the app it is added from, whatever its bundle id says, and moves back", async () => {
    const otherId = await createApp(db, `Other ${projectId}`)
    try {
      const [moved] = await connectRevenueCat({ db, secrets, fetch: revenueCat() }, 'sk_new_key', { appId: otherId })
      expect(moved).toEqual({
        name: 'Integration Test App',
        appId: otherId,
        appName: `Other ${projectId}`,
        movedFrom: 'Integration Test App',
        replaced: null,
      })
      expect((await assetOf(db, 'revenuecat_project', projectId)).appId).toBe(otherId)

      const [back] = await connectRevenueCat({ db, secrets, fetch: revenueCat() }, 'sk_new_key', { appId })
      expect(back).toMatchObject({ appId, movedFrom: `Other ${projectId}` })
    } finally {
      await db.delete(apps).where(eq(apps.id, otherId))
    }
  })

  it('refuses a key from several projects, or an app that is gone, when added from an app', async () => {
    const several = (async (input: Parameters<typeof fetch>[0]) => {
      const { pathname } = new URL(String(input))
      const items = pathname === '/v2/projects' ? [{ id: 'p1', name: 'One' }, { id: 'p2', name: 'Two' }] : []
      return new Response(JSON.stringify({ items }))
    }) as typeof fetch

    await expect(connectRevenueCat({ db, secrets, fetch: several }, 'sk_other', { appId })).rejects.toThrow(
      /can see 2 projects/,
    )
    await expect(
      connectRevenueCat({ db, secrets, fetch: revenueCat() }, 'sk_other', { appId: `gone-${projectId}` }),
    ).rejects.toBeInstanceOf(ConnectInputError)
    expect((await assetOf(db, 'revenuecat_project', projectId)).appId).toBe(appId)
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
    // Two revenue days, one point for each of the other five one-measure charts, three trial
    // outcomes, and the subscriptions bought without a trial.
    expect(first.rowsWritten).toBe(11)

    const stored = await db
      .select({ metric: metricDaily.metric, date: metricDaily.date, value: metricDaily.value })
      .from(metricDaily)
      .where(
        and(
          eq(metricDaily.appId, appId),
          inArray(metricDaily.metric, ['trial_conversions', 'trial_expirations', 'trials_pending', 'direct_subs']),
        ),
      )
      .orderBy(metricDaily.metric)
    // Picked by name, never the chart's first measure (trial starts).
    expect(stored).toEqual([
      { metric: 'direct_subs', date: '2026-11-19', value: 2 },
      { metric: 'trial_conversions', date: '2026-11-12', value: 4 },
      { metric: 'trial_expirations', date: '2026-11-12', value: 5 },
      { metric: 'trials_pending', date: '2026-11-12', value: 1 },
    ])
    // Trials keep converting after they start, so their weeks are read again.
    expect(startDates.trial_conversion_rate).toBe('2026-10-05')
    expect(startDates.revenue).toBe('2026-11-01')

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
    ).rejects.toThrow(/8 of 8 charts failed/)

    const connection = await connectionOf(db, 'revenuecat_project', projectId)
    expect(connection?.status).toBe('needs_reauth')
  })

  it('refuses to connect when no encryption key is configured', async () => {
    await expect(
      connectRevenueCat({ db, secrets: createSecrets(undefined), fetch: revenueCat() }, 'sk_x'),
    ).rejects.toThrow(/ENCRYPTION_KEY/)
  })
})
