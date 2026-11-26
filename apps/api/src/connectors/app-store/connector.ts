import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { linkedAssets } from '../../assets/store.js'
import type { Scope } from '../../organizations/scope.js'
import { apps, connections, type NewMetric } from '../../db/schema.js'
import type { Secrets } from '../../lib/crypto.js'
import { eachDay, todayUtc } from '../../lib/dates.js'
import { mapLimit } from '../../lib/pool.js'
import { upsertMetrics } from '../../metrics/upsert.js'
import type { AccountConnector } from '../types.js'
import { readAnalyticsState, syncStoreAnalytics, type AnalyticsState } from './analytics.js'
import { syncAppStoreReviews, type ReviewsState } from './reviews.js'
import { saveReviews } from '../../reviews/save.js'
import { AppStoreError, createAppStoreClient } from './client.js'
import { fetchAppIcons } from './icons.js'
import { saveAppStoreApps } from './link-apps.js'
import { summarizeSalesReport } from './sales-report.js'
import type { AppStoreCredentials } from './token.js'

export const APP_STORE = 'app_store'

/** Apple keeps daily sales reports for a year. */
export const APP_STORE_HISTORY_DAYS = 364

const credentialsSchema = z.object({
  issuerId: z.string(),
  keyId: z.string(),
  privateKey: z.string(),
  vendorNumber: z.string(),
})

/** The organization's App Store Connect account: a connection that belongs to no particular app. */
export const findAppStoreConnection = ({ db, organizationId }: Scope) =>
  db
    .select()
    .from(connections)
    .where(and(eq(connections.organizationId, organizationId), eq(connections.provider, APP_STORE)))
    .limit(1)
    .then((rows) => rows[0])

export const readAppStoreCredentials = (secrets: Secrets, encrypted: string): AppStoreCredentials =>
  credentialsSchema.parse(JSON.parse(secrets.decrypt(encrypted)))

/**
 * The account's apps and their icons, then downloads, re-downloads and updates per app and day,
 * from Apple's daily Summary Sales Report (one request per day covers every app in the account),
 * then store page views and impressions from each tracked app's analytics reports, then its
 * customer reviews.
 */
export function createAppStoreConnector(options: { fetch?: typeof fetch } = {}): AccountConnector {
  return {
    source: APP_STORE,
    scope: 'account',

    async isConfigured(scope) {
      return (await findAppStoreConnection(scope)) !== undefined
    },

    async sync({ db, organizationId, range, secrets }) {
      const scope = { db, organizationId }
      const connection = await findAppStoreConnection(scope)
      if (!connection?.accessTokenEnc) throw new Error('No App Store Connect key is stored')
      const client = createAppStoreClient({
        credentials: readAppStoreCredentials(secrets, connection.accessTokenEnc),
        fetch: options.fetch,
      })

      const rows: NewMetric[] = []
      const failures: string[] = []
      let keyRejected = false
      let analyticsState: AnalyticsState | undefined
      let reviewsState: ReviewsState | undefined
      let reviewsSaved = 0

      try {
        // Picks up apps published since the last run, and icons changed by a new build.
        const storeApps = await client.listApps()
        const icons = await fetchAppIcons({
          client,
          appleIds: storeApps.map((app) => app.appleId),
          fetch: options.fetch,
        })
        await saveAppStoreApps(scope, connection.id, storeApps, icons)

        // Only this account's iOS apps that belong to an active app. A report says nothing
        // about any other app, so an app from elsewhere (demo data, another account) must not
        // be given zeros.
        const owned = new Set(storeApps.map((app) => app.appleId))
        const active = new Set(
          (
            await db
              .select({ id: apps.id })
              .from(apps)
              .where(and(eq(apps.organizationId, organizationId), eq(apps.isActive, true)))
          ).map((app) => app.id),
        )
        const tracked = (await linkedAssets(scope, 'ios_app'))
          .map(({ asset }) => asset)
          .filter(
            (asset) =>
              asset.connectionId === connection.id &&
              owned.has(asset.externalId) &&
              asset.appId !== null &&
              active.has(asset.appId),
          )
          .map((asset) => ({ id: asset.appId ?? '', iosAppId: asset.externalId, name: asset.name }))

        await mapLimit(eachDay(range), 4, async (date) => {
          if (keyRejected) return
          try {
            const report = await client.getDailySalesReport(date)
            // No report: the day is not ready yet (today, usually yesterday too) or had no activity.
            if (report === null) return
            const totals = summarizeSalesReport(report)
            for (const app of tracked) {
              // A report that exists is complete, so an app missing from it had zero that day.
              const total = totals.get(app.iosAppId ?? '')
              const metric = (name: string, value: number) =>
                rows.push({ appId: app.id, date, source: APP_STORE, metric: name, value })
              metric('downloads', total?.downloads ?? 0)
              metric('redownloads', total?.redownloads ?? 0)
              metric('updates', total?.updates ?? 0)
            }
          } catch (err) {
            if (err instanceof AppStoreError && err.isAuthProblem) keyRejected = true
            failures.push(`${date}: ${err instanceof Error ? err.message : String(err)}`)
          }
        })

        if (!keyRejected) {
          const analytics = await syncStoreAnalytics({
            client,
            tracked,
            range,
            state: readAnalyticsState(connection.details),
            today: todayUtc(),
          })
          rows.push(...analytics.rows)
          failures.push(...analytics.failures)
          analyticsState = analytics.state

          const fetched = await syncAppStoreReviews({ client, tracked, range })
          reviewsSaved = await saveReviews(scope, fetched.readings)
          failures.push(...fetched.failures)
          reviewsState = fetched.state
        }
      } catch (err) {
        if (err instanceof AppStoreError && err.isAuthProblem) keyRejected = true
        failures.push(err instanceof Error ? err.message : String(err))
      }

      const rowsWritten = await upsertMetrics(scope, rows)
      await db
        .update(connections)
        .set({
          status: keyRejected ? 'needs_reauth' : failures.length > 0 ? 'error' : 'ok',
          lastSyncedAt: new Date(),
          ...(analyticsState || reviewsState
            ? {
                details: {
                  ...((connection.details as Record<string, unknown> | null) ?? {}),
                  ...(analyticsState ? { analytics: analyticsState } : {}),
                  ...(reviewsState ? { reviews: reviewsState } : {}),
                },
              }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(connections.id, connection.id))

      if (failures.length > 0) {
        const shown = failures.slice(0, 3).join('; ')
        const more = failures.length > 3 ? ` (and ${failures.length - 3} more)` : ''
        throw new Error(`${failures.length} request(s) failed. ${shown}${more}`)
      }
      return { rowsWritten: rowsWritten + reviewsSaved }
    },
  }
}
