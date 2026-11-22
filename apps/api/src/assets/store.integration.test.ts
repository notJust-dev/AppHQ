import { randomUUID } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '../db/client.js'
import { runMigrations } from '../db/migrate.js'
import { apps, assets, metricDaily } from '../db/schema.js'
import { ConnectInputError } from '../services/errors.js'
import { assetOf } from '../test/assets.js'
import { testDatabaseUrl } from '../test/database.js'
import { assignAsset, autoLink, removeApp, setIgnored } from './store.js'
import { PORTFOLIO_APP_ID } from './kinds.js'

// Runs only when a database is provided: TEST_DATABASE_URL=postgres://.../appdashboard_test
const url = testDatabaseUrl()

describe.skipIf(!url)('Apps and assets, against a real database', () => {
  const { db, sql } = createDb(url ?? 'postgres://unused')
  const run = randomUUID().slice(0, 8)
  const bundleId = `dev.example.store.${run}`
  const ids = { ios: `ios-${run}`, android: bundleId, other: `ios-other-${run}`, third: `ios-third-${run}` }
  const createdApps: string[] = []

  beforeAll(async () => {
    await runMigrations({ db, sql })
    await db.insert(assets).values([
      { kind: 'ios_app', externalId: ids.ios, name: `Store App ${run}`, details: { bundleId } },
      { kind: 'android_app', externalId: ids.android, name: `Store App ${run}` },
      { kind: 'ios_app', externalId: ids.other, name: `Other App ${run}` },
      { kind: 'ios_app', externalId: ids.third, name: `Third App ${run}` },
    ])
  })

  afterAll(async () => {
    if (createdApps.length > 0) await db.delete(apps).where(inArray(apps.id, createdApps))
    await db.delete(assets).where(inArray(assets.externalId, Object.values(ids)))
    await sql.end({ timeout: 5 })
  })

  it('removes an app with its numbers, and leaves what fed it waiting', async () => {
    const ios = await assetOf(db, 'ios_app', ids.ios)
    const { appId } = await assignAsset(db, { assetId: ios.id, appId: 'new' })
    if (!appId) throw new Error('no app')
    createdApps.push(appId)
    // The Android package has the iOS bundle id, so it joined the new app by itself.
    expect((await assetOf(db, 'android_app', ids.android)).appId).toBe(appId)
    await db.insert(metricDaily).values({ appId, date: '2026-11-01', source: 'app_store', metric: 'downloads', value: 3 })

    expect(await removeApp(db, appId)).toBe(`Store App ${run}`)

    expect(await db.select().from(apps).where(eq(apps.id, appId))).toEqual([])
    expect(await db.select().from(metricDaily).where(eq(metricDaily.appId, appId))).toEqual([])
    expect((await assetOf(db, 'ios_app', ids.ios)).appId).toBeNull()
    expect((await assetOf(db, 'android_app', ids.android)).appId).toBeNull()
    // Nothing links them again behind the person's back.
    await autoLink(db)
    expect((await assetOf(db, 'android_app', ids.android)).appId).toBeNull()
  })

  it('refuses to remove Shared accounts or an app that is gone', async () => {
    await expect(removeApp(db, PORTFOLIO_APP_ID)).rejects.toBeInstanceOf(ConnectInputError)
    await expect(removeApp(db, `gone-${run}`)).rejects.toBeInstanceOf(ConnectInputError)
  })

  it('ignores several assets at once, and brings them back', async () => {
    const other = await assetOf(db, 'ios_app', ids.other)
    const third = await assetOf(db, 'ios_app', ids.third)

    expect(await setIgnored(db, [other.id, third.id], true)).toBe(2)
    expect((await assetOf(db, 'ios_app', ids.other)).ignored).toBe(true)
    expect((await assetOf(db, 'ios_app', ids.third)).ignored).toBe(true)

    expect(await setIgnored(db, [third.id], false)).toBe(1)
    expect((await assetOf(db, 'ios_app', ids.third)).ignored).toBe(false)
  })
})
