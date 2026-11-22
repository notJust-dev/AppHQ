import { generateKeyPairSync, randomUUID } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createGooglePlayConnector } from '../connectors/google-play/connector.js'
import { createDb } from '../db/client.js'
import { runMigrations } from '../db/migrate.js'
import { apps, connections, metricDaily } from '../db/schema.js'
import { createSecrets } from '../lib/crypto.js'
import { testDatabaseUrl } from '../test/database.js'
import { ConnectInputError } from './connect-app-store.js'
import { assignPlayPackage, connectGooglePlay, listPlayPackages, parseBucket } from './connect-google-play.js'

// Runs only when a database is provided: TEST_DATABASE_URL=postgres://.../appdashboard_test
const url = testDatabaseUrl()

const utf16 = (text: string) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')])

/** Stands in for Google: the token endpoint, the report bucket and the Reporting API. */
function fakeGoogle(suffix: string, options: { deny?: boolean } = {}) {
  const pkg = `com.tinykicks${suffix}.app`
  const other = `com.other_${suffix}.game`
  const files: Record<string, Buffer> = {
    [`stats/installs/installs_${pkg}_202610_overview.csv`]: utf16(
      'Date,Package Name,Daily Device Installs,Daily User Installs\n2026-10-30,x,9,7\n2026-10-31,x,8,6\n',
    ),
    [`stats/installs/installs_${pkg}_202611_overview.csv`]: utf16(
      'Date,Package Name,Daily Device Installs,Daily User Installs\n2026-11-01,x,12,10\n2026-11-02,x,30,25\n',
    ),
    [`stats/installs/installs_${pkg}_202611_country.csv`]: utf16('Date,Package Name,Country,Daily User Installs\n2026-11-01,x,US,999\n'),
    [`stats/store_performance/store_performance_${pkg}_202611_country.csv`]: utf16(
      'Date,Package name,Country/region,Store listing acquisitions,Store listing visitors,Store listing conversion rate\n' +
        '2026-11-01,x,US,6,100,6%\n2026-11-01,x,DE,4,50,8%\n',
    ),
    [`stats/installs/installs_${other}_202611_country.csv`]: utf16(
      'Date,Package Name,Country,Daily User Installs\n2026-11-01,x,US,3\n2026-11-01,x,BR,4\n',
    ),
  }

  const impl = (async (input: Parameters<typeof fetch>[0]) => {
    const target = new URL(String(input))
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
    if (target.hostname === 'oauth2.googleapis.com') return json({ access_token: 'ya29.test', expires_in: 3599 })
    if (target.hostname === 'playdeveloperreporting.googleapis.com') {
      return json({ apps: [{ packageName: other, displayName: 'Other Game' }] })
    }
    if (options.deny) return json({ error: { code: 403, message: 'does not have storage.objects.list access' } }, 403)

    const listing = /^\/storage\/v1\/b\/([^/]+)\/o$/.exec(target.pathname)
    if (listing) {
      const prefix = target.searchParams.get('prefix') ?? ''
      return json({ items: Object.keys(files).filter((name) => name.startsWith(prefix)).map((name) => ({ name })) })
    }
    const object = /^\/storage\/v1\/b\/[^/]+\/o\/(.+)$/.exec(target.pathname)
    const body = object ? files[decodeURIComponent(object[1] ?? '')] : undefined
    if (body) return new Response(body)
    return json({ error: { code: 404, message: 'Not Found' } }, 404)
  }) as typeof fetch

  return { pkg, other, impl }
}

describe.skipIf(!url)('Google Play, against a real database', () => {
  const { db, sql } = createDb(url ?? 'postgres://unused')
  const secrets = createSecrets('f'.repeat(64))
  const log = { info() {}, warn() {}, error() {} }
  const suffix = randomUUID().slice(0, 8)
  const appId = `gp-${suffix}`
  const google = fakeGoogle(suffix)
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const key = JSON.stringify({
    type: 'service_account',
    client_email: 'reports@my-project.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  })
  const storageUri = `gs://pubsite_prod_rev_${suffix}/stats/installs/`
  const createdApps: string[] = [appId]

  const metric = (id: string, name: string) =>
    db
      .select({ date: metricDaily.date, value: metricDaily.value })
      .from(metricDaily)
      .where(and(eq(metricDaily.appId, id), eq(metricDaily.source, 'google_play'), eq(metricDaily.metric, name)))
      .orderBy(metricDaily.date)

  beforeAll(async () => {
    await runMigrations({ db, sql })
    await db.delete(connections).where(eq(connections.provider, 'google_play'))
    await db.insert(apps).values({ id: appId, name: 'TinyKicks Play', iosBundleId: google.pkg })
  })

  afterAll(async () => {
    await db.delete(connections).where(eq(connections.provider, 'google_play'))
    await db.delete(apps).where(inArray(apps.id, createdApps))
    await sql.end({ timeout: 5 })
  })

  it('reads the bucket from what Play Console copies', () => {
    expect(parseBucket('gs://pubsite_prod_rev_0123456789/stats/installs/')).toBe('pubsite_prod_rev_0123456789')
    expect(parseBucket('pubsite_prod_rev_0123456789')).toBe('pubsite_prod_rev_0123456789')
    expect(parseBucket('not a bucket!')).toBeNull()
  })

  it('explains a key that is not one, and an account Play Console has not invited yet', async () => {
    await expect(
      connectGooglePlay({ db, secrets, fetch: google.impl }, { serviceAccountJson: '{"type":"user"}', storageUri }),
    ).rejects.toBeInstanceOf(ConnectInputError)

    const denied = fakeGoogle(suffix, { deny: true })
    await expect(
      connectGooglePlay({ db, secrets, fetch: denied.impl }, { serviceAccountJson: key, storageUri }),
    ).rejects.toThrow(/has not given reports@my-project.iam.gserviceaccount.com access/)
  })

  it('connects, lists the packages, and matches the one whose iOS bundle id is the same', async () => {
    const result = await connectGooglePlay({ db, secrets, fetch: google.impl }, { serviceAccountJson: key, storageUri })
    expect(result).toEqual({
      serviceAccount: 'reports@my-project.iam.gserviceaccount.com',
      packages: 2,
      matched: 1,
    })

    const listed = await listPlayPackages(db)
    expect(listed?.bucket).toBe(`pubsite_prod_rev_${suffix}`)
    // Sorted by package name.
    expect(listed?.packages).toEqual([
      { packageName: google.other, title: 'Other Game', appId: null },
      { packageName: google.pkg, title: null, appId },
    ])
  })

  it('syncs new users and store listing visitors, preferring the overview file', async () => {
    const connector = createGooglePlayConnector({ fetch: google.impl })
    expect(await connector.isConfigured(db)).toBe(true)
    await connector.sync({ db, apps: [], range: { from: '2026-10-31', to: '2026-11-02' }, log, secrets })

    expect(await metric(appId, 'downloads')).toEqual([
      { date: '2026-10-31', value: 6 },
      { date: '2026-11-01', value: 10 },
      { date: '2026-11-02', value: 25 },
    ])
    expect(await metric(appId, 'page_views')).toEqual([{ date: '2026-11-01', value: 150 }])
    expect(await metric(appId, 'store_acquisitions')).toEqual([{ date: '2026-11-01', value: 10 }])
  })

  it('makes a new app for an Android-only package, then sums its countries', async () => {
    const { appId: created } = await assignPlayPackage(db, { packageName: google.other, appId: 'new' })
    expect(created).toBeTruthy()
    createdApps.push(created ?? '')
    const [app] = await db.select().from(apps).where(eq(apps.id, created ?? ''))
    expect(app).toMatchObject({ name: 'Other Game', androidPackage: google.other })

    await createGooglePlayConnector({ fetch: google.impl }).sync({
      db,
      apps: [],
      range: { from: '2026-11-01', to: '2026-11-01' },
      log,
      secrets,
    })
    expect(await metric(created ?? '', 'downloads')).toEqual([{ date: '2026-11-01', value: 7 }])

    // Taking it away again leaves the app without a package.
    await assignPlayPackage(db, { packageName: google.other, appId: null })
    const [after] = await db.select().from(apps).where(eq(apps.id, created ?? ''))
    expect(after?.androidPackage).toBeNull()
  })
})
