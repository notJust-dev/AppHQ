import { and, eq, isNotNull } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { assets } from '../db/schema.js'

/** The icon kept in a store app's details, if any. */
export function iconOf(details: unknown): string | null {
  if (!details || typeof details !== 'object') return null
  const value = (details as Record<string, unknown>).iconUrl
  return typeof value === 'string' && value !== '' ? value : null
}

/**
 * Each app's icon by app id: the icon of the iOS app linked to it, which the App Store sync
 * keeps current. Read whenever apps are listed, so linking or unlinking an iOS app shows at once.
 */
export async function appIcons(db: Db): Promise<Map<string, string>> {
  const rows = await db
    .select({ appId: assets.appId, details: assets.details })
    .from(assets)
    .where(and(eq(assets.kind, 'ios_app'), isNotNull(assets.appId)))
  const icons = new Map<string, string>()
  for (const row of rows) {
    const icon = iconOf(row.details)
    if (row.appId && icon) icons.set(row.appId, icon)
  }
  return icons
}
