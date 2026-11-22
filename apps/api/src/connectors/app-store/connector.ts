import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { linkedAssets } from '../../assets/store.js'
import type { Db } from '../../db/client.js'
import { apps, connections, type NewMetric } from '../../db/schema.js'
import type { Secrets } from '../../lib/crypto.js'
import { eachDay } from '../../lib/dates.js'
import { mapLimit } from '../../lib/pool.js'
import { upsertMetrics } from '../../metrics/upsert.js'
import type { AccountConnector } from '../types.js'
import { AppStoreError, createAppStoreClient } from './client.js'
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

/** The single App Store Connect account: a connection that belongs to no particular app. */
export const findAppStoreConnection = (db: Db) =>
  db
    .select()
    .from(connections)
    .where(eq(connections.provider, APP_STORE))
    .limit(1)
    .then((rows) => rows[0])

export const readAppStoreCredentials = (secrets: Secrets, encrypted: string): AppStoreCredentials =>
  credentialsSchema.parse(JSON.parse(secrets.decrypt(encrypted)))

/**
 * Downloads, re-downloads and updates per app and day, from Apple's daily Summary Sales Report.
 * One request per day covers every app in the account.
 */
export function createAppStoreConnector(options: { fetch?: typeof fetch } = {}): AccountConnector {
  return {
    source: APP_STORE,
    scope: 'account',

    async isConfigured(db) {
      return (await findAppStoreConnection(db)) !== undefined
    },

    async sync({ db, range, secrets }) {
      const connection = await findAppStoreConnection(db)
      if (!connection?.accessTokenEnc) throw new Error('No App Store Connect key is stored')
      const client = createAppStoreClient({
        credentials: readAppStoreCredentials(secrets, connection.accessTokenEnc),
        fetch: options.fetch,
      })

      const rows: NewMetric[] = []
      const failures: string[] = []
      let keyRejected = false

      try {
        // Picks up apps published since the last run.
        const storeApps = await client.listApps()
        await saveAppStoreApps(db, connection.id, storeApps)

        // Only this account's iOS apps that belong to an active app. A report says nothing
        // about any other app, so an app from elsewhere (demo data, another account) must not
        // be given zeros.
        const owned = new Set(storeApps.map((app) => app.appleId))
        const active = new Set(
          (await db.select({ id: apps.id }).from(apps).where(eq(apps.isActive, true))).map((app) => app.id),
        )
        const tracked = (await linkedAssets(db, 'ios_app'))
          .map(({ asset }) => asset)
          .filter(
            (asset) =>
              asset.connectionId === connection.id &&
              owned.has(asset.externalId) &&
              asset.appId !== null &&
              active.has(asset.appId),
          )
          .map((asset) => ({ id: asset.appId ?? '', iosAppId: asset.externalId }))

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
      } catch (err) {
        if (err instanceof AppStoreError && err.isAuthProblem) keyRejected = true
        failures.push(err instanceof Error ? err.message : String(err))
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
        const shown = failures.slice(0, 3).join('; ')
        const more = failures.length > 3 ? ` (and ${failures.length - 3} more)` : ''
        throw new Error(`${failures.length} request(s) failed. ${shown}${more}`)
      }
      return { rowsWritten }
    },
  }
}
