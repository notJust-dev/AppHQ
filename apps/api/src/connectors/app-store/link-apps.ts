import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import { autoLink, upsertAssets } from '../../assets/store.js'
import type { Db } from '../../db/client.js'
import { assets } from '../../db/schema.js'
import type { AppStoreApp } from './client.js'

/**
 * Saves the account's iOS apps as assets and links those that exact evidence settles (a
 * RevenueCat project or Android package with the same bundle id, already in an app). No app is
 * created: the person adds the ones they want to track on the Apps page. Returns how many of the
 * account's apps belong to an app.
 */
export async function saveAppStoreApps(db: Db, connectionId: string, storeApps: AppStoreApp[]) {
  await upsertAssets(
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
  if (storeApps.length === 0) return { linked: 0 }
  const linked = await db
    .select({ id: assets.id })
    .from(assets)
    .where(
      and(
        eq(assets.kind, 'ios_app'),
        inArray(
          assets.externalId,
          storeApps.map((app) => app.appleId),
        ),
        isNotNull(assets.appId),
      ),
    )
  return { linked: linked.length }
}
