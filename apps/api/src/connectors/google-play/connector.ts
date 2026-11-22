import { and, eq, inArray, isNull } from 'drizzle-orm'
import { z } from 'zod'
import type { Db } from '../../db/client.js'
import { apps, connections, type Connection, type NewMetric } from '../../db/schema.js'
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

export const GOOGLE_PLAY = 'google_play'

/** Play reports go back to each app's launch; a year is enough for the dashboard. */
export const GOOGLE_PLAY_HISTORY_DAYS = 365

const credentialsSchema = z.object({
  serviceAccount: serviceAccountSchema,
  bucket: z.string().min(1),
})
export type PlayCredentials = z.infer<typeof credentialsSchema>

export const detailsSchema = z.object({
  packages: z.array(z.object({ packageName: z.string(), title: z.string().nullable() })),
})
export type PlayDetails = z.infer<typeof detailsSchema>

/** The single Google Play developer account: a connection that belongs to no particular app. */
export const findPlayConnection = (db: Db) =>
  db
    .select()
    .from(connections)
    .where(and(eq(connections.provider, GOOGLE_PLAY), isNull(connections.appId)))
    .limit(1)
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

    async read(file: ReportFile): Promise<string> {
      return decodeReport(await storage.download(bucket, file.name))
    },

    /** App titles by package, or an empty map when the Reporting API is not enabled. */
    titles: () => appTitles({ token, fetch: options.fetch, baseUrl: options.reportingUrl }).catch(() => new Map<string, string>()),
  }
}

/** The package names the reports cover, in order. */
export const packagesIn = (files: { installs: ReportFile[]; store: ReportFile[] }) =>
  [...new Set([...files.installs, ...files.store].map((file) => file.packageName))].sort()

/**
 * Gives each Play package to the app it obviously belongs to: one whose iOS bundle id is the
 * same string and that has no Android package yet. Anything less obvious is left for Settings.
 */
export async function matchPackages(db: Db, packageNames: string[]): Promise<number> {
  if (packageNames.length === 0) return 0
  const known = await db.select().from(apps)
  const taken = new Set(known.map((app) => app.androidPackage).filter(Boolean))
  let matched = 0
  for (const packageName of packageNames) {
    if (taken.has(packageName)) continue
    const app = known.find((candidate) => candidate.iosBundleId === packageName && !candidate.androidPackage)
    if (!app) continue
    await db.update(apps).set({ androidPackage: packageName }).where(eq(apps.id, app.id))
    taken.add(packageName)
    matched++
  }
  return matched
}

/** Stores the packages found, keeping titles already known for packages the lookup missed. */
export async function savePackages(db: Db, connection: Connection, packageNames: string[], titles: Map<string, string>) {
  const previous = detailsSchema.safeParse(connection.details).data?.packages ?? []
  const details: PlayDetails = {
    packages: packageNames.map((packageName) => ({
      packageName,
      title: titles.get(packageName) ?? previous.find((item) => item.packageName === packageName)?.title ?? null,
    })),
  }
  await db.update(connections).set({ details, updatedAt: new Date() }).where(eq(connections.id, connection.id))
}

/**
 * Daily downloads (new users), store listing visitors and acquisitions for every app with a
 * Play package, from the monthly report files. Google posts them 3 to 7 days late and keeps
 * rewriting the current month, so each sync re-reads every month its range touches.
 */
export function createGooglePlayConnector(options: PlayClientOptions = {}): AccountConnector {
  return {
    source: GOOGLE_PLAY,
    scope: 'account',

    async isConfigured(db) {
      return (await findPlayConnection(db)) !== undefined
    },

    async sync({ db, range, secrets, log }) {
      const connection = await findPlayConnection(db)
      if (!connection?.accessTokenEnc) throw new Error('No Google Play service account is stored')
      const client = createPlayClient(readPlayCredentials(secrets, connection.accessTokenEnc), options)

      try {
        const files = await client.files()
        const packageNames = packagesIn(files)
        const known = detailsSchema.safeParse(connection.details).data?.packages ?? []
        const needTitles = packageNames.some((name) => !known.find((item) => item.packageName === name)?.title)
        await savePackages(db, connection, packageNames, needTitles ? await client.titles() : new Map())
        await matchPackages(db, packageNames)

        const tracked = packageNames.length
          ? await db
              .select({ id: apps.id, androidPackage: apps.androidPackage })
              .from(apps)
              .where(and(eq(apps.isActive, true), inArray(apps.androidPackage, packageNames)))
          : []

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

        const written = await upsertMetrics(db, rows)
        await db
          .update(connections)
          .set({ status: 'ok', lastSyncedAt: new Date(), updatedAt: new Date() })
          .where(eq(connections.id, connection.id))
        if (tracked.length < packageNames.length) {
          log.info(`google_play: ${packageNames.length - tracked.length} packages have no app yet`)
        }
        return { rowsWritten: written }
      } catch (err) {
        const lostAccess =
          (err instanceof GoogleAuthError && err.code === 'invalid_grant') ||
          (err instanceof StorageError && err.isAccessProblem)
        await db
          .update(connections)
          .set({ status: lostAccess ? 'needs_reauth' : 'error', updatedAt: new Date() })
          .where(eq(connections.id, connection.id))
        throw err
      }
    },
  }
}
