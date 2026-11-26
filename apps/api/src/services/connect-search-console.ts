import { and, eq } from 'drizzle-orm'
import { GoogleAuthError, serviceAccountSchema, type ServiceAccount } from '../connectors/google-play/auth.js'
import { findPlayConnection, readPlayCredentials } from '../connectors/google-play/connector.js'
import { SEARCH_CONSOLE, SearchConsoleError, createSearchConsoleClient } from '../connectors/search-console/client.js'
import { findSearchConsoleConnection, saveSites, type SearchConsoleOptions } from '../connectors/search-console/connector.js'
import { connections } from '../db/schema.js'
import type { Secrets } from '../lib/crypto.js'
import type { Scope } from '../organizations/scope.js'
import { ConnectInputError } from './connect-app-store.js'

export interface SearchConsoleConnectResult {
  serviceAccount: string
  sites: number
  /** Properties already part of an app. */
  linked: number
}

/** The service account key pasted or dropped, or the one Google Play already uses. */
function serviceAccountFrom(
  deps: Scope & { secrets: Secrets },
  input: { serviceAccountJson?: string; usePlayKey?: boolean },
): Promise<ServiceAccount> | ServiceAccount {
  if (input.usePlayKey) {
    return findPlayConnection(deps).then((play) => {
      if (!play?.accessTokenEnc) throw new ConnectInputError('Google Play is not connected, so there is no key to reuse.')
      return readPlayCredentials(deps.secrets, play.accessTokenEnc).serviceAccount
    })
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(input.serviceAccountJson ?? '')
  } catch {
    throw new ConnectInputError('That is not JSON. Use the whole key file you downloaded for the service account.')
  }
  const account = serviceAccountSchema.safeParse(parsed)
  if (!account.success) {
    throw new ConnectInputError('That is not a service account key. Create a JSON key for the service account in Google Cloud.')
  }
  return account.data
}

/**
 * Connects Google Search Console through a service account the person added to their
 * properties: checks which properties it can read, stores the key encrypted, and saves the
 * properties as websites waiting to be linked to apps.
 */
export async function connectSearchConsole(
  deps: Scope & { secrets: Secrets } & SearchConsoleOptions,
  input: { serviceAccountJson?: string; usePlayKey?: boolean },
): Promise<SearchConsoleConnectResult> {
  const serviceAccount = await serviceAccountFrom(deps, input)
  const email = serviceAccount.client_email
  const client = createSearchConsoleClient({ serviceAccount, fetch: deps.fetch, baseUrl: deps.baseUrl })

  let sites: Awaited<ReturnType<typeof client.listSites>>
  try {
    sites = await client.listSites()
  } catch (err) {
    if (err instanceof GoogleAuthError) throw new ConnectInputError(`Google did not accept this key (${err.code}): ${err.message}`)
    if (err instanceof SearchConsoleError && err.status === 403) {
      throw new ConnectInputError(
        'Google refused the request. Enable the Google Search Console API in the service account’s Google Cloud project, then try again.',
      )
    }
    throw err
  }
  if (sites.length === 0) {
    throw new ConnectInputError(
      `The key works, but no property is shared with ${email}. In Search Console, open Settings, Users and ` +
        'permissions, add this email with Restricted permission, then connect again.',
    )
  }

  const values = {
    displayName: email,
    accessTokenEnc: deps.secrets.encrypt(JSON.stringify({ serviceAccount })),
    status: 'ok',
    updatedAt: new Date(),
  }
  // One Search Console connection: another service account replaces it.
  const linked = await deps.run(async (db) => {
    const existing = await findSearchConsoleConnection(deps)
    if (existing && existing.externalAccountId !== email) {
      await db
        .delete(connections)
        .where(and(eq(connections.organizationId, deps.organizationId), eq(connections.id, existing.id)))
    }
    const [row] = await db
      .insert(connections)
      .values({ organizationId: deps.organizationId, provider: SEARCH_CONSOLE, externalAccountId: email, ...values })
      .onConflictDoUpdate({ target: [connections.organizationId, connections.provider, connections.externalAccountId], set: values })
      .returning()
    if (!row) throw new Error('could not save the Search Console connection')
    return saveSites(deps, row.id, sites)
  })
  return { serviceAccount: email, sites: sites.length, linked }
}
