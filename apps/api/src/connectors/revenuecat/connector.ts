import { eq } from 'drizzle-orm'
import { linkedAssets } from '../../assets/store.js'
import type { Scope } from '../../organizations/scope.js'
import { connections, type App, type NewMetric } from '../../db/schema.js'
import { addDays } from '../../lib/dates.js'
import { upsertMetrics } from '../../metrics/upsert.js'
import type { AppConnector } from '../types.js'
import { RevenueCatError, createRevenueCatClient } from './client.js'
import { toDailySeries } from './parse.js'

export const REVENUECAT = 'revenuecat'

interface ChartSpec {
  chart: string
  /** The metrics stored from this chart, each picked by its measure's display name. */
  measures: readonly { metric: string; wanted: RegExp }[]
  /**
   * Only the named measures are stored, never a stand-in. For charts whose measures are parts
   * of one whole, where the first measure would be a wrong number rather than a near one.
   */
  strict?: boolean
  /**
   * Days to read back from the end of the range, at least. A chart counted by the day a trial
   * started keeps changing until the trial ends, so its recent weeks are read again each time.
   */
  lookbackDays?: number
}

/** Which RevenueCat charts are stored, and under which metric names. */
const CHARTS: readonly ChartSpec[] = [
  { chart: 'revenue', measures: [{ metric: 'revenue', wanted: /^revenue$/i }] },
  { chart: 'mrr', measures: [{ metric: 'mrr', wanted: /mrr/i }] },
  { chart: 'actives', measures: [{ metric: 'active_subs', wanted: /active/i }] },
  { chart: 'trials', measures: [{ metric: 'active_trials', wanted: /trial/i }] },
  { chart: 'trials_new', measures: [{ metric: 'trials', wanted: /trial/i }] },
  { chart: 'customers_new', measures: [{ metric: 'new_customers', wanted: /customer/i }] },
  // By the day each trial started: how many of them converted, expired, or are still running.
  // The three add up to the trials started that day.
  {
    chart: 'trial_conversion_rate',
    measures: [
      { metric: 'trial_conversions', wanted: /^conversions$/i },
      { metric: 'trial_expirations', wanted: /^expirations$/i },
      { metric: 'trials_pending', wanted: /^pending$/i },
    ],
    strict: true,
    lookbackDays: 45,
  },
  // New paid subscriptions that did not start with a trial.
  { chart: 'actives_new', measures: [{ metric: 'direct_subs', wanted: /^direct subscriptions$/i }], strict: true },
]

/** The app's RevenueCat project and the key that reads it. */
const findProject = (scope: Scope, app: App) =>
  linkedAssets(scope, 'revenuecat_project', app.id).then((rows) => rows.find((row) => row.connection) ?? null)

/** Revenue, subscription and trial metrics, one RevenueCat project per app. Eight requests per run. */
export function createRevenueCatConnector(options: { fetch?: typeof fetch } = {}): AppConnector {
  return {
    source: REVENUECAT,
    scope: 'app',

    async isConfigured(app, scope) {
      return (await findProject(scope, app)) !== null
    },

    async sync({ db, organizationId, app, range, log, secrets }) {
      const scope = { db, organizationId }
      const found = await findProject(scope, app)
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

      // One failing chart must not cost the others, so each is fetched on its own.
      for (const spec of CHARTS) {
        const { chart } = spec
        const from = spec.lookbackDays ? minDate(range.from, addDays(range.to, -spec.lookbackDays)) : range.from
        try {
          const response = await client.getDailyChart(projectId, chart, { from, to: range.to })
          for (const { metric, wanted } of spec.measures) {
            const series = toDailySeries(response, wanted)
            const matched = series.measure !== null && wanted.test(series.measure)
            if (spec.strict && !matched) {
              log.warn(`revenuecat ${app.id}: chart ${chart} has no measure matching ${wanted}; ${metric} not stored`)
              continue
            }
            if (series.fallback) {
              log.warn(`revenuecat ${app.id}: chart ${chart} has no measure matching ${wanted}; used "${series.measure}"`)
            }
            for (const point of series.points) {
              rows.push({ appId: app.id, date: point.date, source: REVENUECAT, metric, value: point.value })
            }
          }
        } catch (err) {
          if (err instanceof RevenueCatError && err.isAuthProblem) keyRejected = true
          failures.push(`${chart}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }

      const rowsWritten = await upsertMetrics(scope, rows)
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

const minDate = (left: string, right: string) => (left < right ? left : right)
