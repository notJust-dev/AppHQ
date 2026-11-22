import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import { iconOf } from '../../assets/icons.js'
import { autoLink, upsertAssets } from '../../assets/store.js'
import type { Db } from '../../db/client.js'
import { assets } from '../../db/schema.js'
import type { AppStoreApp } from './client.js'

/**
 * Saves the account's iOS apps as assets, with their icons by Apple ID, and links those that
 * exact evidence settles (a RevenueCat project or Android package with the same bundle id,
 * already in an app). No app is created: the person adds the ones they want to track on the Apps
 * page. Returns how many of the account's apps belong to an app.
 */
export async function saveAppStoreApps(
  db: Db,
  connectionId: string,
  storeApps: AppStoreApp[],
  icons: ReadonlyMap<string, string> = new Map(),
) {
  const appleIds = storeApps.map((app) => app.appleId)
  // An icon Apple did not give this time (a refusal, an outage) stays as it was.
  const known =
    appleIds.length === 0
      ? []
      : await db
          .select({ externalId: assets.externalId, details: assets.details })
          .from(assets)
          .where(and(eq(assets.kind, 'ios_app'), inArray(assets.externalId, appleIds)))
  const previousIcons = new Map(known.map((row) => [row.externalId, iconOf(row.details)]))

  await upsertAssets(
    db,
    storeApps.map((app) => {
      const iconUrl = icons.get(app.appleId) ?? previousIcons.get(app.appleId)
      return {
        kind: 'ios_app' as const,
        externalId: app.appleId,
        name: app.name,
        connectionId,
        details: { bundleId: app.bundleId, ...(iconUrl ? { iconUrl } : {}) },
      }
    }),
  )
  await autoLink(db)
  if (storeApps.length === 0) return { linked: 0 }
  const linked = await db
    .select({ id: assets.id })
    .from(assets)
    .where(
      and(
        eq(assets.kind, 'ios_app'),
        inArray(assets.externalId, appleIds),
        isNotNull(assets.appId),
      ),
    )
  return { linked: linked.length }
}
