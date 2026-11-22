import { generateKeyPairSync, randomUUID } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createAppStoreConnector,
  findAppStoreConnection,
  readAppStoreCredentials,
} from '../connectors/app-store/connector.js'
import { salesReport } from '../connectors/app-store/fixtures.js'
import { createDb } from '../db/client.js'
import { runMigrations } from '../db/migrate.js'
import { apps, assets, connections, metricDaily } from '../db/schema.js'
import { assignAsset } from '../assets/store.js'
import { assetOf } from '../test/assets.js'
import { createSecrets } from '../lib/crypto.js'
import { testDatabaseUrl } from '../test/database.js'
import { ConnectInputError, connectAppStore } from './connect-app-store.js'
import { connectRevenueCat } from './connect-revenuecat.js'

// Runs only when a database is provided: TEST_DATABASE_URL=postgres://.../appdashboard_test
const url = testDatabaseUrl()

describe.skipIf(!url)('App Store Connect, against a real database', () => {
  const { db, sql } = createDb(url ?? 'postgres://unused')
  const secrets = createSecrets('d'.repeat(64))
  const log = { info() {}, warn() {}, error() {} }

  const run = randomUUID().slice(0, 8)
  const first = { id: `9${Date.now()}1`, name: `Store App One ${run}`, bundleId: `dev.example.one.${run}` }
  const second = { id: `9${Date.now()}2`, name: `Store App Two ${run}`, bundleId: `dev.example.two.${run}` }
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const input = {
    issuerId: 'issuer-integration',
    keyId: 'KEYINTEG',
    vendorNumber: '85999001',
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  }

  const reports: Record<string, string> = {
    '2026-11-17': salesReport([
      { appleId: first.id, productType: '1F', units: 12 },
      { appleId: first.id, productType: '7F', units: 30 },
      { appleId: second.id, productType: '1', units: 4 },
    ]),
    // The second app had no activity on this day and is absent from the report.
    '2026-11-18': salesReport([{ appleId: first.id, productType: '1F', units: 9 }]),
  }

  /** Stands in for App Store Connect. */
  const appStore = (options: { admin?: boolean; reject?: boolean } = {}) =>
    (async (target: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const { pathname, searchParams } = new URL(String(target))
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
      const refuse = (status: number) => json({ errors: [{ code: 'DENIED', detail: 'denied' }] }, status)

      if (options.reject) return refuse(401)
      if (pathname === '/v1/apps') {
        return json({
          data: [first, second].map((app) => ({
            id: app.id,
            attributes: { name: app.name, bundleId: app.bundleId },
          })),
        })
      }
      if (pathname === '/v1/salesReports') {
        const report = reports[searchParams.get('filter[reportDate]') ?? '']
        return report ? new Response(gzipSync(report)) : refuse(404)
      }
      if (pathname.endsWith('/analyticsReportRequests')) {
        if (init?.method === 'POST') return options.admin === false ? refuse(403) : json({}, 201)
        return json({ data: [] })
      }
      return refuse(404)
    }) as typeof fetch

  /** The apps the two iOS apps of the account belong to, with each one's bundle id. */
  const ourApps = async () => {
    const linked = await db
      .select()
      .from(assets)
      .where(and(eq(assets.kind, 'ios_app'), inArray(assets.externalId, [first.id, second.id])))
    const ids = linked.flatMap((asset) => (asset.appId ? [asset.appId] : []))
    if (ids.length === 0) return []
    const rows = await db.select().from(apps).where(inArray(apps.id, ids)).orderBy(apps.name)
    return rows.map((app) => ({
      ...app,
      bundleId: (linked.find((asset) => asset.appId === app.id)?.details as { bundleId?: string } | null)?.bundleId,
    }))
  }

  beforeAll(async () => {
    await runMigrations({ db, sql })
  })

  afterAll(async () => {
    const created = (await ourApps()).map((app) => app.id)
    if (created.length > 0) await db.delete(apps).where(inArray(apps.id, created))
    await db.delete(assets).where(inArray(assets.externalId, [first.id, second.id, `proj_${run}`]))
    await db.delete(connections).where(eq(connections.externalAccountId, `proj_${run}`))
    await db
      .delete(connections)
      .where(and(eq(connections.provider, 'app_store'), eq(connections.externalAccountId, input.vendorNumber)))
    await sql.end({ timeout: 5 })
  })

  it('rejects a private key that is not one, before contacting Apple', async () => {
    await expect(
      connectAppStore({ db, secrets, fetch: appStore() }, { ...input, privateKey: 'nonsense' }),
    ).rejects.toBeInstanceOf(ConnectInputError)
  })

  it("finds the account's apps without adding any, and stores the key encrypted", async () => {
    const result = await connectAppStore({ db, secrets, fetch: appStore() }, input)

    expect(result).toEqual({
      apps: 2,
      linked: 0,
      analytics: { requested: 2, existing: 0, problem: null },
    })
    // They wait on the Apps page until the person adds the ones to track.
    expect(await ourApps()).toEqual([])
    expect(await assetOf(db, 'ios_app', first.id)).toMatchObject({ appId: null, details: { bundleId: first.bundleId } })

    const connection = await findAppStoreConnection(db)
    expect(connection?.displayName).toBe('Vendor 85999001')
    expect(connection?.accessTokenEnc).not.toContain('PRIVATE KEY')
    expect(readAppStoreCredentials(secrets, connection?.accessTokenEnc ?? '')).toMatchObject({
      issuerId: 'issuer-integration',
      vendorNumber: '85999001',
    })
  })

  it('adds the apps the person picks', async () => {
    for (const app of [first, second]) {
      await assignAsset(db, { assetId: (await assetOf(db, 'ios_app', app.id)).id, appId: 'new' })
    }
    expect((await ourApps()).map((app) => app.bundleId)).toEqual([first.bundleId, second.bundleId])
  })

  it('still connects with a key that may not request analytics reports', async () => {
    const result = await connectAppStore({ db, secrets, fetch: appStore({ admin: false }) }, input)

    expect(result.linked).toBe(2)
    expect(result.analytics.requested).toBe(0)
    expect(result.analytics.problem).toMatch(/Admin key/)
  })

  it('writes downloads per app and day, with zero for an app missing from a report', async () => {
    const connector = createAppStoreConnector({ fetch: appStore() })
    const range = { from: '2026-11-16', to: '2026-11-19' }

    await connector.sync({ db, apps: [], range, log, secrets })
    // Running it again must not duplicate anything.
    await connector.sync({ db, apps: [], range, log, secrets })

    const [one, two] = await ourApps()
    const downloads = (appId: string) =>
      db
        .select({ date: metricDaily.date, value: metricDaily.value })
        .from(metricDaily)
        .where(and(eq(metricDaily.appId, appId), eq(metricDaily.metric, 'downloads')))
        .orderBy(metricDaily.date)

    // Nothing is written for the 16th and 19th, which had no report at all.
    expect(await downloads(one?.id ?? '')).toEqual([
      { date: '2026-11-17', value: 12 },
      { date: '2026-11-18', value: 9 },
    ])
    expect(await downloads(two?.id ?? '')).toEqual([
      { date: '2026-11-17', value: 4 },
      { date: '2026-11-18', value: 0 },
    ])
    expect((await findAppStoreConnection(db))?.status).toBe('ok')
  })

  it('leaves an app from outside the account alone', async () => {
    const outsider = { id: `outsider-${run}`, name: 'Outsider' }
    await db.insert(apps).values(outsider)
    await db.insert(assets).values({ kind: 'ios_app', externalId: `not-in-account-${run}`, name: 'Outsider', appId: outsider.id })
    try {
      await db.insert(metricDaily).values({
        appId: outsider.id,
        date: '2026-11-17',
        source: 'app_store',
        metric: 'downloads',
        value: 55,
      })

      const connector = createAppStoreConnector({ fetch: appStore() })
      await connector.sync({ db, apps: [], range: { from: '2026-11-17', to: '2026-11-18' }, log, secrets })

      const rows = await db
        .select({ date: metricDaily.date, value: metricDaily.value })
        .from(metricDaily)
        .where(eq(metricDaily.appId, outsider.id))
      expect(rows).toEqual([{ date: '2026-11-17', value: 55 }])
    } finally {
      await db.delete(apps).where(eq(apps.id, outsider.id))
      await db.delete(assets).where(eq(assets.externalId, `not-in-account-${run}`))
    }
  })

  it('reuses a store app when its RevenueCat project is connected afterwards', async () => {
    const projectId = `proj_${run}`
    const revenueCat = (async (target: Parameters<typeof fetch>[0]) => {
      const { pathname } = new URL(String(target))
      const body = pathname.endsWith('/apps')
        ? { items: [{ id: 'a1', type: 'app_store', app_store: { bundle_id: first.bundleId } }] }
        : { items: [{ id: projectId, name: 'A Different Name In RevenueCat' }] }
      return new Response(JSON.stringify(body))
    }) as typeof fetch

    const [connected] = await connectRevenueCat({ db, secrets, fetch: revenueCat }, 'sk_live_key')

    const [one] = await ourApps()
    expect(connected).toEqual({
      name: 'A Different Name In RevenueCat',
      appId: one?.id,
      appName: one?.name,
      movedFrom: null,
      replaced: null,
    })
    expect((await assetOf(db, 'revenuecat_project', projectId)).appId).toBe(one?.id)
    expect(await ourApps()).toHaveLength(2)
  })

  it('marks the account for a new key when Apple rejects it', async () => {
    const connector = createAppStoreConnector({ fetch: appStore({ reject: true }) })

    await expect(
      connector.sync({ db, apps: [], range: { from: '2026-11-17', to: '2026-11-18' }, log, secrets }),
    ).rejects.toThrow(/failed/)

    expect((await findAppStoreConnection(db))?.status).toBe('needs_reauth')
  })
})
