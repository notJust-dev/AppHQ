import { eq } from 'drizzle-orm'
import { linkedAssets } from '../../assets/store.js'
import type { Db } from '../../db/client.js'
import { connections, type App, type NewMetric } from '../../db/schema.js'
import { upsertMetrics } from '../../metrics/upsert.js'
import type { AppConnector } from '../types.js'
import { RevenueCatError, createRevenueCatClient } from './client.js'
import { toDailySeries } from './parse.js'

export const REVENUECAT = 'revenuecat'

/**
 * Which RevenueCat charts are stored, and under which metric name. `wanted` picks the measure
 * inside the chart by its display name.
 */
const CHARTS = [
  { chart: 'revenue', metric: 'revenue', wanted: /^revenue$/i },
  { chart: 'mrr', metric: 'mrr', wanted: /mrr/i },
  { chart: 'actives', metric: 'active_subs', wanted: /active/i },
  { chart: 'trials', metric: 'active_trials', wanted: /trial/i },
  { chart: 'trials_new', metric: 'trials', wanted: /trial/i },
  { chart: 'customers_new', metric: 'new_customers', wanted: /customer/i },
] as const

/** The app's RevenueCat project and the key that reads it. */
const findProject = (db: Db, app: App) =>
  linkedAssets(db, 'revenuecat_project', app.id).then((rows) => rows.find((row) => row.connection) ?? null)

/** Revenue and subscription metrics, one RevenueCat project per app. Six requests per run. */
export function createRevenueCatConnector(options: { fetch?: typeof fetch } = {}): AppConnector {
  return {
    source: REVENUECAT,
    scope: 'app',

    async isConfigured(app, db) {
      return (await findProject(db, app)) !== null
    },

    async sync({ db, app, range, log, secrets }) {
      const found = await findProject(db, app)
      const connection = found?.connection
      const projectId = found?.asset.externalId
      if (!connection?.accessTokenEnc || !projectId) {
        throw new Error('No RevenueCat key is stored for this app')
      }
      const client = createRevenueCatClient({
        apiKey: secrets.decrypt(connection.accessTokenEnc),
        fetch: options.fetch,
      })

      const rows: NewMetric[] = []
      const failures: string[] = []
      let keyRejected = false

      // One failing chart must not cost the other five, so each is fetched on its own.
      for (const { chart, metric, wanted } of CHARTS) {
        try {
          const series = toDailySeries(
            await client.getDailyChart(projectId, chart, range),
            wanted,
          )
          if (series.fallback) {
            log.warn(`revenuecat ${app.id}: chart ${chart} has no measure matching ${wanted}; used "${series.measure}"`)
          }
          for (const point of series.points) {
            rows.push({ appId: app.id, date: point.date, source: REVENUECAT, metric, value: point.value })
          }
        } catch (err) {
          if (err instanceof RevenueCatError && err.isAuthProblem) keyRejected = true
          failures.push(`${chart}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }

      const rowsWritten = await upsertMetrics(db, rows)
      await db
        .update(connections)
        .set({
          status: keyRejected ? 'needs_reauth' : failures.length > 0 ? 'error' : 'ok',
          lastSyncedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(connections.id, connection.id))

      if (failures.length > 0) {
        throw new Error(`${failures.length} of ${CHARTS.length} charts failed. ${failures.join('; ')}`)
      }
      return { rowsWritten }
    },
  }
}
