import { eq } from 'drizzle-orm'
import type { Db } from '../../db/client.js'
import { apps } from '../../db/schema.js'
import { uniqueSlug } from '../../lib/slug.js'
import type { AppStoreApp } from './client.js'

/**
 * Brings the `apps` table in step with the App Store account: an app already known by its Apple
 * ID or bundle id gets both recorded, and an app seen for the first time is added. Apps are
 * matched by bundle id so that an app connected through RevenueCat first is not duplicated.
 */
export async function linkAppStoreApps(db: Db, storeApps: AppStoreApp[]) {
  return db.transaction(async (tx) => {
    const known = await tx.select().from(apps)
    const taken = new Set(known.map((app) => app.id))
    let created = 0
    let linked = 0

    for (const storeApp of storeApps) {
      const existing = known.find(
        (app) => app.iosAppId === storeApp.appleId || app.iosBundleId === storeApp.bundleId,
      )
      if (existing) {
        if (existing.iosAppId !== storeApp.appleId || existing.iosBundleId !== storeApp.bundleId) {
          await tx
            .update(apps)
            .set({ iosAppId: storeApp.appleId, iosBundleId: storeApp.bundleId })
            .where(eq(apps.id, existing.id))
          linked++
        }
        continue
      }
      const id = uniqueSlug(storeApp.name, taken)
      taken.add(id)
      await tx.insert(apps).values({
        id,
        name: storeApp.name,
        iosAppId: storeApp.appleId,
        iosBundleId: storeApp.bundleId,
      })
      created++
    }
    return { created, linked }
  })
}
