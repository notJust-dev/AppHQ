import { generateKeyPairSync, randomUUID } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { assignAsset } from '../assets/store.js'
import { createSearchConsoleConnector, findSearchConsoleConnection } from '../connectors/search-console/connector.js'
import { siteName } from '../connectors/search-console/client.js'
import { createDb } from '../db/client.js'
import { runMigrations } from '../db/migrate.js'
import { apps, assets, connections, metricDaily } from '../db/schema.js'
import { createSecrets } from '../lib/crypto.js'
import { testDatabaseUrl } from '../test/database.js'
import { defaultScope } from '../test/organizations.js'
import type { Scope } from '../organizations/scope.js'
import { ConnectInputError } from './connect-app-store.js'
import { connectSearchConsole } from './connect-search-console.js'
import { searchTop } from './search-top.js'

// Runs only when a database is provided: TEST_DATABASE_URL=postgres://.../appdashboard_test
const url = testDatabaseUrl()

describe.skipIf(!url)('Google Search Console, against a real database', () => {
  const { db, sql } = createDb(url ?? 'postgres://unused')
  let scope: Scope
  const secrets = createSecrets('e'.repeat(64))
  const log = { info() {}, warn() {}, error() {} }
  const run = randomUUID().slice(0, 8)
  const appId = `sc-${run}`
  const site = `sc-domain:example-${run}.com`
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const key = JSON.stringify({
    type: 'service_account',
    client_email: `seo-${run}@my-project.iam.gserviceaccount.com`,
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  })

  /** Stands in for Google: the token endpoint, the property list and search analytics. */
  const google = (options: { shared?: boolean } = {}) =>
    (async (target: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const address = new URL(String(target))
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
      if (address.hostname === 'oauth2.googleapis.com') return json({ access_token: 'ya29.test', expires_in: 3599 })
      if (address.pathname === '/webmasters/v3/sites') {
        return json({
          siteEntry:
            options.shared === false
              ? []
              : [
                  { siteUrl: site, permissionLevel: 'siteRestrictedUser' },
                  { siteUrl: `https://unverified-${run}.com/`, permissionLevel: 'siteUnverifiedUser' },
                ],
        })
      }
      if (address.pathname.endsWith('/searchAnalytics/query')) {
        const body = JSON.parse(String(init?.body)) as { dimensions: string[] }
        if (body.dimensions[0] === 'date') {
          // No row for the 2nd: no impressions that day. The 4th is not in yet.
          return json({
            rows: [
              { keys: ['2026-11-01'], clicks: 10, impressions: 200, ctr: 0.05, position: 8 },
              { keys: ['2026-11-03'], clicks: 4, impressions: 100, ctr: 0.04, position: 12 },
            ],
          })
        }
        return json({
          rows: [
            { keys: ['habit tracker'], clicks: 9, impressions: 150, ctr: 0.06, position: 6 },
            { keys: ['streak app'], clicks: 5, impressions: 150, ctr: 0.03, position: 14 },
          ],
        })
      }
      return json({ error: { message: 'not found' } }, 404)
    }) as typeof fetch

  beforeAll(async () => {
    await runMigrations({ db, sql })
    scope = await defaultScope(db)
    await db.delete(connections).where(eq(connections.provider, 'search_console'))
    await db.insert(apps).values({ organizationId: scope.organizationId, id: appId, name: 'Habit Site' })
  })

  afterAll(async () => {
    await db.delete(connections).where(eq(connections.provider, 'search_console'))
    // Assets first: an app that an asset still points at cannot be deleted.
    await db.delete(assets).where(inArray(assets.externalId, [site, `https://unverified-${run}.com/`]))
    await db.delete(apps).where(and(eq(apps.organizationId, scope.organizationId), eq(apps.id, appId)))
    await sql.end({ timeout: 5 })
  })

  it('names properties the way people read them', () => {
    expect(siteName('sc-domain:example.com')).toBe('example.com')
    expect(siteName('https://example.com/')).toBe('example.com')
    expect(siteName('https://example.com/blog/')).toBe('example.com/blog')
  })

  it('says what to do when no property is shared with the key', async () => {
    await expect(
      connectSearchConsole({ ...scope, secrets, fetch: google({ shared: false }) }, { serviceAccountJson: key }),
    ).rejects.toThrow(ConnectInputError)
  })

  it('saves the verified properties as websites waiting for an app', async () => {
    const result = await connectSearchConsole({ ...scope, secrets, fetch: google() }, { serviceAccountJson: key })
    expect(result).toEqual({ serviceAccount: `seo-${run}@my-project.iam.gserviceaccount.com`, sites: 1, linked: 0 })
    const [saved] = await db.select().from(assets).where(eq(assets.externalId, site))
    expect(saved).toMatchObject({ kind: 'search_console_site', name: `example-${run}.com`, appId: null })
    expect((await findSearchConsoleConnection(scope))?.accessTokenEnc).not.toContain('PRIVATE KEY')
  })

  it('writes clicks, impressions and a weighted position per day once linked', async () => {
    const [saved] = await db.select().from(assets).where(eq(assets.externalId, site))
    await assignAsset(scope, { assetId: saved?.id ?? '', appId })
    await createSearchConsoleConnector({ fetch: google() }).sync({
      ...scope,
      apps: [],
      range: { from: '2026-11-01', to: '2026-11-04' },
      log,
      secrets,
    })

    const metric = (name: string) =>
      db
        .select({ date: metricDaily.date, value: metricDaily.value })
        .from(metricDaily)
        .where(and(eq(metricDaily.appId, appId), eq(metricDaily.metric, name)))
        .orderBy(metricDaily.date)
    expect(await metric('search_clicks')).toEqual([
      { date: '2026-11-01', value: 10 },
      { date: '2026-11-02', value: 0 },
      { date: '2026-11-03', value: 4 },
    ])
    expect((await metric('search_position_sum')).map((row) => row.value)).toEqual([1600, 0, 1200])
    expect((await findSearchConsoleConnection(scope))?.status).toBe('ok')
  })

  it('reads the top queries live, with position weighted by impressions', async () => {
    const top = await searchTop(
      { ...scope, secrets, fetch: google() },
      { appId, from: '2026-11-01', to: '2026-11-04', dimension: 'query', limit: 10 },
    )
    expect(top).toEqual({
      connected: true,
      rows: [
        { key: 'habit tracker', clicks: 9, impressions: 150, position: 6 },
        { key: 'streak app', clicks: 5, impressions: 150, position: 14 },
      ],
    })
  })
})
