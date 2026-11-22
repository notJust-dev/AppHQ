import { and, eq, ne } from 'drizzle-orm'
import { createAppStoreClient } from '../connectors/app-store/client.js'
import { APP_STORE } from '../connectors/app-store/connector.js'
import { saveAppStoreApps } from '../connectors/app-store/link-apps.js'
import { isPrivateKey, type AppStoreCredentials } from '../connectors/app-store/token.js'
import type { Db } from '../db/client.js'
import { connections } from '../db/schema.js'
import type { Secrets } from '../lib/crypto.js'
import { addDays, todayUtc } from '../lib/dates.js'
import { ConnectInputError } from './errors.js'

export { ConnectInputError }

export interface AppStoreConnectResult {
  /** Apps in the App Store account. */
  apps: number
  /** How many of the account's apps already belong to an app; the rest wait on the Apps page. */
  linked: number
}

/**
 * Connects the App Store Connect account: checks the key and the vendor number against Apple,
 * stores the key encrypted, and saves the account's apps for the person to pick from. Analytics
 * reports are asked for later, by the sync, for the apps that are tracked.
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

  const connection = {
    displayName: `Vendor ${credentials.vendorNumber}`,
    accessTokenEnc: encrypted,
    status: 'ok',
    // A new key starts over: whether it may ask for analytics reports is found out again.
    details: null,
    updatedAt: new Date(),
  }
  const saved = await deps.db.transaction(async (tx) => {
    // One App Store account at a time: a different vendor replaces the previous one.
    await tx
      .delete(connections)
      .where(and(eq(connections.provider, APP_STORE), ne(connections.externalAccountId, credentials.vendorNumber)))
    const [row] = await tx
      .insert(connections)
      .values({ provider: APP_STORE, externalAccountId: credentials.vendorNumber, ...connection })
      .onConflictDoUpdate({
        target: [connections.provider, connections.externalAccountId],
        set: connection,
      })
      .returning({ id: connections.id })
    return row
  })
  if (!saved) throw new Error('could not save the App Store connection')

  const { linked } = await saveAppStoreApps(deps.db, saved.id, storeApps)

  return { apps: storeApps.length, linked }
}
