import { sql } from 'drizzle-orm'
import type { Scope } from '../organizations/scope.js'
import { metricDaily, type NewMetric } from '../db/schema.js'

const CHUNK = 1000

/**
 * Writes one organization's metric rows, replacing any existing value for the same app, day, source, metric and
 * dimension. This is what makes every connector safe to re-run over the same date range.
 */
export async function upsertMetrics(
  { db, organizationId }: Scope,
  rows: NewMetric[],
): Promise<number> {
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db
      .insert(metricDaily)
      .values(rows.slice(i, i + CHUNK).map((row) => ({ ...row, organizationId })))
      .onConflictDoUpdate({
        target: [
          metricDaily.organizationId,
          metricDaily.appId,
          metricDaily.date,
          metricDaily.source,
          metricDaily.metric,
          metricDaily.dimension,
        ],
        set: { value: sql`excluded.value`, updatedAt: sql`now()` },
      })
  }
  return rows.length
}
