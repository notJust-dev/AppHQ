import { randomUUID } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '../db/client.js'
import { runMigrations } from '../db/migrate.js'
import { apps, assets, metricDaily } from '../db/schema.js'
import { ConnectInputError } from '../services/errors.js'
import { assetOf } from '../test/assets.js'
import { testDatabaseUrl } from '../test/database.js'
import { defaultScope } from '../test/organizations.js'
import type { Scope } from '../organizations/scope.js'
import { assignAsset, autoLink, portfolioApp, removeApp, renameApp, setIgnored } from './store.js'

// Runs only when a database is provided: TEST_DATABASE_URL=postgres://.../appdashboard_test
const url = testDatabaseUrl()

describe.skipIf(!url)('Apps and assets, against a real database', () => {
  const { db, sql } = createDb(url ?? 'postgres://unused')
  const run = randomUUID().slice(0, 8)
  const bundleId = `dev.example.store.${run}`
  const ids = { ios: `ios-${run}`, android: bundleId, other: `ios-other-${run}`, third: `ios-third-${run}` }
  const createdApps: string[] = []
  let scope: Scope

  beforeAll(async () => {
    await runMigrations({ db, sql })
    scope = await defaultScope(db)
    const { organizationId } = scope
    await db.insert(assets).values([
      { organizationId, kind: 'ios_app', externalId: ids.ios, name: `Store App ${run}`, details: { bundleId } },
      { organizationId, kind: 'android_app', externalId: ids.android, name: `Store App ${run}` },
      { organizationId, kind: 'ios_app', externalId: ids.other, name: `Other App ${run}` },
      { organizationId, kind: 'ios_app', externalId: ids.third, name: `Third App ${run}` },
    ])
  })

  afterAll(async () => {
    if (createdApps.length > 0) await db.delete(apps).where(inArray(apps.id, createdApps))
    await db.delete(assets).where(inArray(assets.externalId, Object.values(ids)))
    await sql.end({ timeout: 5 })
  })

  it('renames an app and keeps its id, but not Shared accounts', async () => {
    const third = await assetOf(db, 'ios_app', ids.third)
    const { appId } = await assignAsset(scope, { assetId: third.id, appId: 'new' })
    if (!appId) throw new Error('no app')
    createdApps.push(appId)

    expect(await renameApp(scope, appId, `Renamed ${run}`)).toBe(`Renamed ${run}`)
    const [app] = await db.select().from(apps).where(eq(apps.id, appId))
    expect(app?.id).toBe(appId)
    expect(app?.name).toBe(`Renamed ${run}`)
    const portfolio = await portfolioApp(scope)
    await expect(renameApp(scope, portfolio, 'Mine')).rejects.toBeInstanceOf(ConnectInputError)

    await assignAsset(scope, { assetId: third.id, appId: null })
  })

  it('removes an app with its numbers, and leaves what fed it waiting', async () => {
    const ios = await assetOf(db, 'ios_app', ids.ios)
    const { appId } = await assignAsset(scope, { assetId: ios.id, appId: 'new' })
    if (!appId) throw new Error('no app')
    createdApps.push(appId)
    // The Android package has the iOS bundle id, so it joined the new app by itself.
    expect((await assetOf(db, 'android_app', ids.android)).appId).toBe(appId)
    await db.insert(metricDaily).values({ organizationId: scope.organizationId, appId, date: '2026-11-01', source: 'app_store', metric: 'downloads', value: 3 })

    expect(await removeApp(scope, appId)).toBe(`Store App ${run}`)

    expect(await db.select().from(apps).where(eq(apps.id, appId))).toEqual([])
    expect(await db.select().from(metricDaily).where(eq(metricDaily.appId, appId))).toEqual([])
    expect((await assetOf(db, 'ios_app', ids.ios)).appId).toBeNull()
    expect((await assetOf(db, 'android_app', ids.android)).appId).toBeNull()
    // Nothing links them again behind the person's back.
    await autoLink(scope)
    expect((await assetOf(db, 'android_app', ids.android)).appId).toBeNull()
  })

  it('refuses to remove Shared accounts or an app that is gone', async () => {
    await expect(removeApp(scope, await portfolioApp(scope))).rejects.toBeInstanceOf(ConnectInputError)
    await expect(removeApp(scope, randomUUID())).rejects.toBeInstanceOf(ConnectInputError)
  })

  it('ignores several assets at once, and brings them back', async () => {
    const other = await assetOf(db, 'ios_app', ids.other)
    const third = await assetOf(db, 'ios_app', ids.third)

    expect(await setIgnored(scope, [other.id, third.id], true)).toBe(2)
    expect((await assetOf(db, 'ios_app', ids.other)).ignored).toBe(true)
    expect((await assetOf(db, 'ios_app', ids.third)).ignored).toBe(true)

    expect(await setIgnored(scope, [third.id], false)).toBe(1)
    expect((await assetOf(db, 'ios_app', ids.third)).ignored).toBe(false)
  })
})
