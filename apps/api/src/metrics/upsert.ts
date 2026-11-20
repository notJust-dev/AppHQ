import { sql } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { metricDaily, type NewMetric } from '../db/schema.js'

const CHUNK = 1000

/**
 * Writes metric rows, replacing any existing value for the same app, day, source, metric and
 * dimension. This is what makes every connector safe to re-run over the same date range.
 */
export async function upsertMetrics(db: Db, rows: NewMetric[]): Promise<number> {
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db
      .insert(metricDaily)
      .values(rows.slice(i, i + CHUNK))
      .onConflictDoUpdate({
        target: [
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
