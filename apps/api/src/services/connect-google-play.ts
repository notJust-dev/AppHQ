import { eq } from 'drizzle-orm'
import { GoogleAuthError, serviceAccountSchema } from '../connectors/google-play/auth.js'
import {
  GOOGLE_PLAY,
  createPlayClient,
  detailsSchema,
  findPlayConnection,
  matchPackages,
  packagesIn,
  savePackages,
  type PlayClientOptions,
} from '../connectors/google-play/connector.js'
import { StorageError } from '../connectors/google-play/storage.js'
import type { Db } from '../db/client.js'
import { apps, connections } from '../db/schema.js'
import type { Secrets } from '../lib/crypto.js'
import { uniqueSlug } from '../lib/slug.js'
import { ConnectInputError } from './connect-app-store.js'

/**
 * The bucket from what Play Console's "Copy Cloud Storage URI" gives
 * (`gs://pubsite_prod_rev_0123…/stats/installs/`), or from the bare bucket id.
 */
export function parseBucket(input: string): string | null {
  const trimmed = input.trim()
  const fromUri = /^gs:\/\/([^/]+)/.exec(trimmed)?.[1]
  const bucket = fromUri ?? trimmed.replace(/\/.*$/, '')
  return /^[a-z0-9][a-z0-9._-]{2,221}$/.test(bucket) ? bucket : null
}

export interface GooglePlayConnectResult {
  serviceAccount: string
  packages: number
  /** Packages given to an app automatically, because an iOS bundle id is the same. */
  matched: number
}

/**
 * Connects the Google Play developer account: checks the service account key and that it can
 * read the account's report files, stores the key encrypted, and lists the packages found.
 */
export async function connectGooglePlay(
  deps: { db: Db; secrets: Secrets } & PlayClientOptions,
  input: { serviceAccountJson: string; storageUri: string },
): Promise<GooglePlayConnectResult> {
  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(input.serviceAccountJson)
  } catch {
    throw new ConnectInputError('That is not JSON. Paste the whole key file you downloaded for the service account.')
  }
  const account = serviceAccountSchema.safeParse(parsedJson)
  if (!account.success) {
    throw new ConnectInputError(
      'That is not a service account key. Create a JSON key for the service account in Google Cloud and paste the whole file.',
    )
  }
  const bucket = parseBucket(input.storageUri)
  if (!bucket) {
    throw new ConnectInputError(
      'Paste the Cloud Storage URI from Play Console (Download reports, Statistics, Copy Cloud Storage URI). It starts with gs://pubsite_prod_rev_.',
    )
  }

  const credentials = { serviceAccount: account.data, bucket }
  const encrypted = deps.secrets.encrypt(JSON.stringify(credentials))
  const client = createPlayClient(credentials, deps)
  const email = account.data.client_email

  let files: Awaited<ReturnType<typeof client.files>>
  try {
    files = await client.files()
  } catch (err) {
    if (err instanceof GoogleAuthError) {
      throw new ConnectInputError(`Google did not accept this key (${err.code}): ${err.message}`)
    }
    if (err instanceof StorageError && err.isAccessProblem) {
      throw new ConnectInputError(
        `Google Play has not given ${email} access to the reports yet. In Play Console, open Users ` +
          'and permissions, invite this email, and give it "View app information and download bulk ' +
          'reports" for all apps. Access can take up to a day to start working.',
      )
    }
    if (err instanceof StorageError && err.status === 404) {
      throw new ConnectInputError(`There is no bucket called ${bucket}. Copy the Cloud Storage URI from Play Console again.`)
    }
    throw err
  }

  const packageNames = packagesIn(files)
  if (packageNames.length === 0) {
    throw new ConnectInputError(
      'The key works, but there are no install reports in that bucket yet. New accounts get their first reports a few days after the first install.',
    )
  }

  const values = {
    displayName: email,
    accessTokenEnc: encrypted,
    status: 'ok',
    updatedAt: new Date(),
  }
  // One Play account: a new bucket replaces the old connection rather than adding a second.
  const existing = await findPlayConnection(deps.db)
  if (existing && existing.externalAccountId !== bucket) {
    await deps.db.delete(connections).where(eq(connections.id, existing.id))
  }
  const [connection] = await deps.db
    .insert(connections)
    .values({ provider: GOOGLE_PLAY, externalAccountId: bucket, ...values })
    .onConflictDoUpdate({ target: [connections.provider, connections.externalAccountId], set: values })
    .returning()
  if (!connection) throw new Error('could not save the Google Play connection')

  await savePackages(deps.db, connection, packageNames, await client.titles())
  const matched = await matchPackages(deps.db, packageNames)
  return { serviceAccount: email, packages: packageNames.length, matched }
}

/** The packages found in the reports, each with the app it belongs to, if any. */
export async function listPlayPackages(db: Db) {
  const connection = await findPlayConnection(db)
  if (!connection) return null
  const packages = detailsSchema.safeParse(connection.details).data?.packages ?? []
  const owners = await db.select({ id: apps.id, name: apps.name, androidPackage: apps.androidPackage }).from(apps)
  return {
    serviceAccount: connection.displayName,
    bucket: connection.externalAccountId,
    status: connection.status,
    lastSyncedAt: connection.lastSyncedAt?.toISOString() ?? null,
    packages: packages.map((item) => {
      const owner = owners.find((app) => app.androidPackage === item.packageName)
      return { ...item, appId: owner?.id ?? null }
    }),
  }
}

/**
 * Gives a package to an app (`appId`), to a new app made for it (`'new'`), or to none (`null`).
 * An app has one Play package, so giving it another replaces the old one.
 */
export async function assignPlayPackage(
  db: Db,
  input: { packageName: string; appId: string | null },
): Promise<{ appId: string | null }> {
  const listed = await listPlayPackages(db)
  const item = listed?.packages.find((entry) => entry.packageName === input.packageName)
  if (!item) throw new ConnectInputError('That package is not in the Google Play reports. Reload the page.')

  return db.transaction(async (tx) => {
    await tx.update(apps).set({ androidPackage: null }).where(eq(apps.androidPackage, input.packageName))
    if (input.appId === null) return { appId: null }

    if (input.appId === 'new') {
      const known = await tx.select({ id: apps.id }).from(apps)
      const name = item.title ?? input.packageName
      const id = uniqueSlug(name, new Set(known.map((app) => app.id)))
      await tx.insert(apps).values({ id, name, androidPackage: input.packageName })
      return { appId: id }
    }

    const [app] = await tx.select({ id: apps.id }).from(apps).where(eq(apps.id, input.appId)).limit(1)
    if (!app) throw new ConnectInputError('That app no longer exists. Reload the page.')
    await tx.update(apps).set({ androidPackage: input.packageName }).where(eq(apps.id, app.id))
    return { appId: app.id }
  })
}
