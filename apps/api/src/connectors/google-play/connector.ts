import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import { autoLink, linkedAssets, upsertAssets } from '../../assets/store.js'
import { z } from 'zod'
import type { Scope, Tx } from '../../organizations/scope.js'
import { apps, assets, connections, type NewMetric } from '../../db/schema.js'
import type { Secrets } from '../../lib/crypto.js'
import { mapLimit } from '../../lib/pool.js'
import { upsertMetrics } from '../../metrics/upsert.js'
import type { AccountConnector } from '../types.js'
import { GoogleAuthError, STORAGE_READ_SCOPE, createTokenSource, serviceAccountSchema } from './auth.js'
import { REPORTING_SCOPE, appTitles } from './reporting.js'
import {
  INSTALLS_PREFIX,
  STORE_PREFIX,
  dailyAcquisitions,
  dailyInstalls,
  dailyVisitors,
  decodeReport,
  monthsIn,
  parseInstallsName,
  parseStoreName,
  type ReportFile,
} from './reports.js'
import { StorageError, createStorageClient } from './storage.js'
import { REVIEWS_PREFIX, parseReviewsName, readPlayReviews, type ReviewsFile } from './reviews.js'
import { saveReviews, type ReviewReading } from '../../reviews/save.js'

export const GOOGLE_PLAY = 'google_play'

/** Play reports go back to each app's launch; a year is enough for the dashboard. */
export const GOOGLE_PLAY_HISTORY_DAYS = 365

const credentialsSchema = z.object({
  serviceAccount: serviceAccountSchema,
  bucket: z.string().min(1),
})
export type PlayCredentials = z.infer<typeof credentialsSchema>


/** The organization's Google Play developer account: a connection that belongs to no particular app. */
export const findPlayConnection = (scope: Scope) =>
  scope
    .run((db) =>
      db
        .select()
        .from(connections)
        .where(and(eq(connections.organizationId, scope.organizationId), eq(connections.provider, GOOGLE_PLAY)))
        .limit(1),
    )
    .then((rows) => rows[0])

export const readPlayCredentials = (secrets: Secrets, encrypted: string): PlayCredentials =>
  credentialsSchema.parse(JSON.parse(secrets.decrypt(encrypted)))

export interface PlayClientOptions {
  fetch?: typeof fetch
  storageUrl?: string
  reportingUrl?: string
}

/** Everything needed to read one account's reports: Cloud Storage, and titles when available. */
export function createPlayClient(credentials: PlayCredentials, options: PlayClientOptions = {}) {
  const token = createTokenSource(credentials.serviceAccount, `${STORAGE_READ_SCOPE} ${REPORTING_SCOPE}`, {
    fetch: options.fetch,
  })
  const storage = createStorageClient({ token, fetch: options.fetch, baseUrl: options.storageUrl })
  const { bucket } = credentials

  return {
    /** Every install and store listing report in the bucket, by file name. */
    async files() {
      const [installs, store] = await Promise.all([
        storage.list(bucket, INSTALLS_PREFIX),
        storage.list(bucket, STORE_PREFIX),
      ])
      return {
        installs: installs.map((item) => parseInstallsName(item.name)).filter((file): file is ReportFile => file !== null),
        store: store.map((item) => parseStoreName(item.name)).filter((file): file is ReportFile => file !== null),
      }
    },

    async read(file: ReportFile | ReviewsFile): Promise<string> {
      return decodeReport(await storage.download(bucket, file.name))
    },

    /** Every monthly reviews file in the bucket. */
    async reviewFiles(): Promise<ReviewsFile[]> {
      return (await storage.list(bucket, REVIEWS_PREFIX))
        .map((item) => parseReviewsName(item.name))
        .filter((file): file is ReviewsFile => file !== null)
    },

    /** App titles by package, or an empty map when the Reporting API is not enabled. */
    titles: () => appTitles({ token, fetch: options.fetch, baseUrl: options.reportingUrl }).catch(() => new Map<string, string>()),
  }
}

/** The package names the reports cover, in order. */
export const packagesIn = (files: { installs: ReportFile[]; store: ReportFile[] }) =>
  [...new Set([...files.installs, ...files.store].map((file) => file.packageName))].sort()

/**
 * Saves the packages the reports cover as Android app assets, with titles when known, and links
 * the ones exact evidence settles (a package equal to an app's iOS bundle id, or named in its
 * RevenueCat project). The rest wait for a decision in the dashboard.
 */
export async function savePackages(scope: Scope, connectionId: string, packageNames: string[], titles: Map<string, string>) {
  // No call to Google in here: one unit of work.
  return scope.run((db) => savePackagesIn(db, scope, connectionId, packageNames, titles))
}

async function savePackagesIn(db: Tx, scope: Scope, connectionId: string, packageNames: string[], titles: Map<string, string>) {
  const { organizationId } = scope
  const known = new Map(
    (await db.select().from(assets).where(and(eq(assets.organizationId, organizationId), eq(assets.kind, 'android_app')))).map((asset) => [asset.externalId, asset]),
  )
  await upsertAssets(
    scope,
    packageNames.map((packageName) => {
      const previous = known.get(packageName)
      const previousTitle = (previous?.details as { title?: string } | null)?.title ?? null
      const title = titles.get(packageName) ?? previousTitle
      return {
        kind: 'android_app' as const,
        externalId: packageName,
        name: title ?? previous?.name ?? packageName,
        connectionId,
        details: { title },
      }
    }),
  )
  await autoLink(scope)
  // How many of this account's packages belong to an app now; autoLink's own count covers
  // every asset, not just these.
  const linked = await db
    .select({ id: assets.id })
    .from(assets)
    .where(
      and(
        eq(assets.organizationId, organizationId),
        eq(assets.kind, 'android_app'),
        inArray(assets.externalId, packageNames),
        isNotNull(assets.appId),
      ),
    )
  return linked.length
}

/**
 * Daily downloads (new users), store listing visitors and acquisitions for every app with a
 * Play package, from the monthly report files, and its written reviews. Google posts them 3 to 7 days late and keeps
 * rewriting the current month, so each sync re-reads every month its range touches.
 */
export function createGooglePlayConnector(options: PlayClientOptions = {}): AccountConnector {
  return {
    source: GOOGLE_PLAY,
    scope: 'account',

    async isConfigured(scope) {
      return (await findPlayConnection(scope)) !== undefined
    },

    async sync(scope) {
      const { organizationId, range, secrets, log } = scope
      const connection = await findPlayConnection(scope)
      if (!connection?.accessTokenEnc) throw new Error('No Google Play service account is stored')
      const client = createPlayClient(readPlayCredentials(secrets, connection.accessTokenEnc), options)

      try {
        const files = await client.files()
        const packageNames = packagesIn(files)
        const titled = new Set(
          (
            await scope.run((db) =>
              db.select().from(assets).where(and(eq(assets.organizationId, organizationId), eq(assets.kind, 'android_app'))),
            )
          )
            .filter((asset) => (asset.details as { title?: string } | null)?.title)
            .map((asset) => asset.externalId),
        )
        const needTitles = packageNames.some((name) => !titled.has(name))
        await savePackages(scope, connection.id, packageNames, needTitles ? await client.titles() : new Map())

        const active = new Set(
          (
            await scope.run((db) =>
              db
                .select({ id: apps.id })
                .from(apps)
                .where(and(eq(apps.organizationId, organizationId), eq(apps.isActive, true))),
            )
          ).map((app) => app.id),
        )
        const tracked = (await linkedAssets(scope, 'android_app'))
          .map(({ asset }) => asset)
          .filter((asset) => asset.connectionId === connection.id && asset.appId !== null && active.has(asset.appId))
          .map((asset) => ({ id: asset.appId ?? '', androidPackage: asset.externalId }))

        const months = new Set(monthsIn(range.from, range.to))
        const inRange = (date: string) => date >= range.from && date <= range.to
        const rows: NewMetric[] = []
        const push = (appId: string, metric: string, values: Map<string, number>) => {
          for (const [date, value] of values) {
            if (inRange(date)) rows.push({ appId, date, source: GOOGLE_PLAY, metric, value })
          }
        }

        const jobs = tracked.flatMap((app) =>
          [...months].map((month) => ({ appId: app.id, packageName: app.androidPackage ?? '', month })),
        )
        await mapLimit(jobs, 4, async ({ appId, packageName, month }) => {
          const ofMonth = (list: ReportFile[], dimension: string) =>
            list.find((file) => file.packageName === packageName && file.month === month && file.dimension === dimension)
          // The overview has one row per day; failing that, countries add up to the same total.
          const installs = ofMonth(files.installs, 'overview') ?? ofMonth(files.installs, 'country')
          if (installs) push(appId, 'downloads', dailyInstalls(await client.read(installs)))
          const store = ofMonth(files.store, 'country')
          if (store) {
            const text = await client.read(store)
            push(appId, 'page_views', dailyVisitors(text))
            push(appId, 'store_acquisitions', dailyAcquisitions(text))
          }
        })

        const written = await upsertMetrics(scope, rows)

        // Reviews live in the same bucket. A problem reading them is logged, so it never holds
        // back the installs.
        let reviewsSaved = 0
        try {
          const reviewFiles = await client.reviewFiles()
          const readings: ReviewReading[] = []
          const since = new Date(`${range.from}T00:00:00Z`)
          await mapLimit(
            tracked.flatMap((app) => [...months].map((month) => ({ app, month }))),
            4,
            async ({ app, month }) => {
              const file = reviewFiles.find((entry) => entry.packageName === app.androidPackage && entry.month === month)
              if (!file) return
              for (const review of readPlayReviews(await client.read(file), app.id, app.androidPackage ?? '')) {
                if (review.createdAt >= since || (review.editedAt && review.editedAt >= since)) readings.push(review)
              }
            },
          )
          reviewsSaved = await saveReviews(scope, readings)
        } catch (err) {
          log.warn(`google_play: reviews not read: ${err instanceof Error ? err.message : String(err)}`)
        }
        await scope.run((db) =>
          db
            .update(connections)
            .set({ status: 'ok', lastSyncedAt: new Date(), updatedAt: new Date() })
            .where(and(eq(connections.organizationId, organizationId), eq(connections.id, connection.id))),
        )
        if (tracked.length < packageNames.length) {
          log.info(`google_play: ${packageNames.length - tracked.length} packages have no app yet`)
        }
        return { rowsWritten: written + reviewsSaved }
      } catch (err) {
        const lostAccess =
          (err instanceof GoogleAuthError && err.code === 'invalid_grant') ||
          (err instanceof StorageError && err.isAccessProblem)
        await scope.run((db) =>
          db
            .update(connections)
            .set({ status: lostAccess ? 'needs_reauth' : 'error', updatedAt: new Date() })
            .where(and(eq(connections.organizationId, organizationId), eq(connections.id, connection.id))),
        )
        throw err
      }
    },
  }
}
