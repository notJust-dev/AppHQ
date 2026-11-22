import { eq } from 'drizzle-orm'
import { GoogleAuthError, serviceAccountSchema } from '../connectors/google-play/auth.js'
import {
  GOOGLE_PLAY,
  createPlayClient,
  findPlayConnection,
  packagesIn,
  savePackages,
  type PlayClientOptions,
} from '../connectors/google-play/connector.js'
import { StorageError } from '../connectors/google-play/storage.js'
import type { Db } from '../db/client.js'
import { connections } from '../db/schema.js'
import type { Secrets } from '../lib/crypto.js'
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
  /** Packages linked to an app automatically, by exact evidence. */
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

  const matched = await savePackages(deps.db, connection.id, packageNames, await client.titles())
  return { serviceAccount: email, packages: packageNames.length, matched }
}
