import { eq } from 'drizzle-orm'
import { linkedAssets } from '../../assets/store.js'
import type { Db } from '../../db/client.js'
import { connections, type NewMetric } from '../../db/schema.js'
import type { IsoDate } from '../../lib/dates.js'
import { MetaError } from './client.js'

/** Posts younger than this are re-read on every sync; older ones keep their last totals. */
export const FRESH_POST_DAYS = 30
/** How far back posts are listed. */
export const POST_HISTORY_DAYS = 365

/** The Pages or Instagram accounts linked to an app, as their connection rows (tokens, state). */
export const metaConnections = (db: Db, provider: string, appId: string) =>
  linkedAssets(db, provider === 'facebook' ? 'facebook_page' : 'instagram_account', appId).then((rows) =>
    rows.flatMap((row) => (row.connection ? [row.connection] : [])),
  )

/** Sums values per metric and day across an app's accounts. */
export class DailyTotals {
  private readonly totals = new Map<string, number>()

  add(metric: string, day: IsoDate, value: number) {
    const key = `${metric}|${day}`
    this.totals.set(key, (this.totals.get(key) ?? 0) + value)
  }

  rows(appId: string, source: string): NewMetric[] {
    return [...this.totals].map(([key, value]) => {
      const [metric = '', date = ''] = key.split('|')
      return { appId, date, source, metric, value }
    })
  }
}

/**
 * Whether a failure is about one optional piece (a metric this Page lacks, one post's insights)
 * rather than the account: those are skipped with a warning instead of failing the account.
 */
export const isPartial = (err: unknown) =>
  err instanceof MetaError && !err.isAuthProblem && !err.isRateLimit

export const describe = (err: unknown) => (err instanceof Error ? err.message : String(err))

export async function markAccount(
  db: Db,
  connectionId: string,
  outcome: { ok: true; displayName?: string; now: Date } | { ok: false; err: unknown; now: Date },
) {
  if (outcome.ok) {
    await db
      .update(connections)
      .set({
        status: 'ok',
        lastSyncedAt: outcome.now,
        updatedAt: outcome.now,
        ...(outcome.displayName ? { displayName: outcome.displayName } : {}),
      })
      .where(eq(connections.id, connectionId))
    return
  }
  const authProblem = outcome.err instanceof MetaError && outcome.err.isAuthProblem
  await db
    .update(connections)
    .set({ status: authProblem ? 'needs_reauth' : 'error', updatedAt: outcome.now })
    .where(eq(connections.id, connectionId))
}
