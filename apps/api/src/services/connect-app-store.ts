import { and, eq, isNull, ne } from 'drizzle-orm'
import { AppStoreError, createAppStoreClient } from '../connectors/app-store/client.js'
import { APP_STORE } from '../connectors/app-store/connector.js'
import { linkAppStoreApps } from '../connectors/app-store/link-apps.js'
import { isPrivateKey, type AppStoreCredentials } from '../connectors/app-store/token.js'
import type { Db } from '../db/client.js'
import { connections } from '../db/schema.js'
import type { Secrets } from '../lib/crypto.js'
import { addDays, todayUtc } from '../lib/dates.js'

/** A problem with what was typed, as opposed to something Apple or the server did. */
export class ConnectInputError extends Error {}

export interface AppStoreConnectResult {
  /** Apps in the App Store account. */
  apps: number
  /** Of those, how many were new to the dashboard. */
  created: number
  analytics: {
    /** Report requests created now. */
    requested: number
    /** Apps that already had one. */
    existing: number
    /** Set when requests could not be created, most often because the key is not Admin. */
    problem: string | null
  }
}

/**
 * Connects the App Store Connect account: checks the key and the vendor number against Apple,
 * stores the key encrypted, adds the account's apps, and asks Apple to start generating
 * analytics reports for them (which needs an Admin key and is skipped without one).
 */
export async function connectAppStore(
  deps: { db: Db; secrets: Secrets; fetch?: typeof fetch },
  input: AppStoreCredentials,
): Promise<AppStoreConnectResult> {
  const credentials: AppStoreCredentials = {
    issuerId: input.issuerId.trim(),
    keyId: input.keyId.trim(),
    vendorNumber: input.vendorNumber.trim(),
    privateKey: input.privateKey.trim(),
  }
  if (!isPrivateKey(credentials.privateKey)) {
    throw new ConnectInputError(
      'The private key is not valid. Paste the whole .p8 file, including the BEGIN and END lines.',
    )
  }

  // Encrypt first: if the key cannot be stored, fail before sending anything anywhere.
  const encrypted = deps.secrets.encrypt(JSON.stringify(credentials))
  const client = createAppStoreClient({ credentials, fetch: deps.fetch })

  // Listing apps proves the key. Asking for a report proves the vendor number and the role;
  // "no report for that day" is a fine answer.
  const storeApps = await client.listApps()
  await client.getDailySalesReport(addDays(todayUtc(), -2))

  const { created } = await linkAppStoreApps(deps.db, storeApps)

  const connection = {
    displayName: `Vendor ${credentials.vendorNumber}`,
    accessTokenEnc: encrypted,
    status: 'ok',
    updatedAt: new Date(),
  }
  await deps.db.transaction(async (tx) => {
    // One App Store account at a time: a different vendor replaces the previous one.
    await tx
      .delete(connections)
      .where(
        and(
          eq(connections.provider, APP_STORE),
          isNull(connections.appId),
          ne(connections.externalAccountId, credentials.vendorNumber),
        ),
      )
    await tx
      .insert(connections)
      .values({ provider: APP_STORE, externalAccountId: credentials.vendorNumber, ...connection })
      .onConflictDoUpdate({
        target: [connections.provider, connections.externalAccountId],
        set: connection,
      })
  })

  const analytics: AppStoreConnectResult['analytics'] = { requested: 0, existing: 0, problem: null }
  for (const app of storeApps) {
    try {
      if (await client.hasOngoingReportRequest(app.appleId)) {
        analytics.existing++
      } else {
        await client.createOngoingReportRequest(app.appleId)
        analytics.requested++
      }
    } catch (err) {
      analytics.problem =
        err instanceof AppStoreError && err.isAuthProblem
          ? 'The key is not allowed to request analytics reports. That needs an Admin key.'
          : err instanceof Error
            ? err.message
            : String(err)
      // A role problem is the same for every app, so stop at the first one.
      break
    }
  }

  return { apps: storeApps.length, created, analytics }
}
