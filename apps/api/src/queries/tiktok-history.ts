import { and, eq, isNotNull } from 'drizzle-orm'
import type { Scope } from '../organizations/scope.js'
import { sameConnection } from '../organizations/joins.js'
import { assets, connections } from '../db/schema.js'
import { addDays, toIsoDate, type IsoDate } from '../lib/dates.js'

/**
 * The first day TikTok views are true daily gains, for one app or across all apps: the day after
 * its most recently connected TikTok account was connected. Before it, TikTok views sit on the
 * day each video was posted (TikTok keeps no daily history; see `dailyViews`), so a chart can say
 * so. Null when no TikTok account belongs to an app.
 */
export async function tiktokDailyFrom({ db, organizationId }: Scope, appId?: string): Promise<IsoDate | null> {
  const rows = await db
    .select({ connectedAt: connections.createdAt })
    .from(assets)
    .innerJoin(connections, sameConnection)
    .where(and(eq(assets.organizationId, organizationId), eq(assets.kind, 'tiktok_account'), appId ? eq(assets.appId, appId) : isNotNull(assets.appId)))
  if (rows.length === 0) return null
  const latest = Math.max(...rows.map((row) => row.connectedAt.getTime()))
  return addDays(toIsoDate(new Date(latest)), 1)
}
