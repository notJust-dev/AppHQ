import { eq } from 'drizzle-orm'
import { autoLink, createApp, upsertAssets } from '../../assets/store.js'
import type { Db } from '../../db/client.js'
import { assets } from '../../db/schema.js'
import type { AppStoreApp } from './client.js'

/**
 * Saves the account's iOS apps as assets. One seen for the first time goes to the app exact
 * evidence points at (a RevenueCat project or Android package with the same bundle id) or,
 * failing that, gets an app of its own: most apps start on iOS. One the user has unlinked or
 * ignored stays that way.
 */
export async function saveAppStoreApps(db: Db, connectionId: string, storeApps: AppStoreApp[]) {
  const known = new Set(
    (await db.select({ externalId: assets.externalId }).from(assets).where(eq(assets.kind, 'ios_app'))).map(
      (row) => row.externalId,
    ),
  )
  const saved = await upsertAssets(
    db,
    storeApps.map((app) => ({
      kind: 'ios_app' as const,
      externalId: app.appleId,
      name: app.name,
      connectionId,
      details: { bundleId: app.bundleId },
    })),
  )
  await autoLink(db)

  let created = 0
  for (const asset of saved) {
    if (known.has(asset.externalId)) continue
    const [fresh] = await db.select().from(assets).where(eq(assets.id, asset.id)).limit(1)
    if (!fresh || fresh.appId !== null || fresh.ignored) continue
    const appId = await createApp(db, asset.name)
    await db.update(assets).set({ appId, updatedAt: new Date() }).where(eq(assets.id, asset.id))
    created++
  }
  // A new app can make other links obvious, e.g. an Android package equal to its bundle id.
  if (created > 0) await autoLink(db)
  return { created }
}
