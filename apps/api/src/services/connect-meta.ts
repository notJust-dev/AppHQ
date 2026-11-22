import { and, eq, inArray } from 'drizzle-orm'
import { MetaError, createMetaClient, type MetaPage } from '../connectors/meta/client.js'
import { FACEBOOK, INSTAGRAM, META_PROVIDERS, requireMetaConfig } from '../connectors/meta/config.js'
import type { Db } from '../db/client.js'
import { apps, connections } from '../db/schema.js'
import type { Secrets } from '../lib/crypto.js'
import { ConnectInputError } from './connect-app-store.js'

export interface MetaConnectResult {
  pages: number
  instagram: number
  /** When the sign-in, and with it Instagram, has to be renewed. */
  expiresAt: string | null
}

/** A token that lasts less than this is a short-lived user token, worth swapping. */
const SHORT_LIVED_S = 7 * 86_400

/** An empty list for a call the token is not allowed; anything else is a real failure. */
const unlessRefused = <T>(err: unknown): T[] => {
  if (err instanceof MetaError && !err.isAuthProblem && !err.isRateLimit) return []
  throw err
}

/**
 * Finishes a Facebook sign-in and saves every Page and Instagram account it can see. They start
 * unassigned; Settings then says which app each promotes. Signing in again renews the tokens and
 * keeps those choices.
 *
 * Two Meta setups end here, both through Facebook Login for Business:
 * - Facebook login: the code gives a short-lived user token, swapped for one of about 60 days.
 *   Pages come with Page tokens (no expiry) and their linked Instagram accounts.
 * - Unified login (Meta's recommended Instagram setup): the code gives a system-user token that
 *   belongs to the business portfolio and usually does not expire, and Instagram accounts are
 *   assigned directly, with or without a Page.
 *
 * Instagram accounts keep the linked Page's token when there is one, and the sign-in token; the
 * connector tries them in that order.
 */
export async function connectMeta(
  deps: { db: Db; secrets: Secrets; fetch?: typeof fetch; env?: NodeJS.ProcessEnv },
  input: { code: string; redirectUri: string },
): Promise<MetaConnectResult> {
  const config = requireMetaConfig(deps.env)
  // The code works once, so make sure the tokens can be stored before spending it.
  deps.secrets.encrypt('check')

  const client = createMetaClient({ config, fetch: deps.fetch })
  const first = await client.exchangeCode(input)
  let signInToken = first.access_token
  let expiresIn = first.expires_in
  if (expiresIn !== undefined && expiresIn < SHORT_LIVED_S) {
    try {
      const long = await client.longLived(signInToken)
      signInToken = long.access_token
      expiresIn = long.expires_in
    } catch (err) {
      // A token that cannot be swapped is used as it is.
      if (!(err instanceof MetaError) || err.isRateLimit) throw err
    }
  }
  const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000) : null

  const pages = (await client.pages(signInToken).catch(unlessRefused<MetaPage>)).filter(
    (page) => page.access_token,
  )
  const instagramAccounts = new Map<string, { username?: string; name?: string; pageToken?: string; pageName?: string }>()
  for (const page of pages) {
    const account = page.instagram_business_account
    if (account) {
      instagramAccounts.set(account.id, { ...account, pageToken: page.access_token, pageName: page.name })
    }
  }
  for (const account of await client
    .assignedInstagramAccounts(signInToken)
    .catch(unlessRefused<{ id: string; username?: string }>)) {
    if (!instagramAccounts.has(account.id)) instagramAccounts.set(account.id, account)
  }

  if (pages.length === 0 && instagramAccounts.size === 0) {
    throw new ConnectInputError(
      'Facebook returned no Pages or Instagram accounts. Sign in again and select them when ' +
        'Facebook asks which ones to share.',
    )
  }

  const encryptedSignIn = deps.secrets.encrypt(signInToken)
  await deps.db.transaction(async (tx) => {
    const save = (row: {
      provider: string
      externalAccountId: string
      displayName: string
      accessTokenEnc: string
      refreshTokenEnc: string | null
      expiresAt: Date | null
    }) => {
      // `appId` is left out of the update, so reconnecting keeps each account's app.
      const values = { ...row, status: 'ok', updatedAt: new Date() }
      return tx
        .insert(connections)
        .values(values)
        .onConflictDoUpdate({ target: [connections.provider, connections.externalAccountId], set: values })
    }

    for (const page of pages) {
      await save({
        provider: FACEBOOK,
        externalAccountId: page.id,
        displayName: page.name,
        accessTokenEnc: deps.secrets.encrypt(page.access_token ?? ''),
        refreshTokenEnc: null,
        expiresAt: null,
      })
    }
    for (const [id, account] of instagramAccounts) {
      await save({
        provider: INSTAGRAM,
        externalAccountId: id,
        displayName: account.username
          ? `@${account.username}`
          : (account.name ?? account.pageName ?? 'Instagram account'),
        // Without a linked Page the sign-in token is the only one, so it fills both places.
        accessTokenEnc: account.pageToken ? deps.secrets.encrypt(account.pageToken) : encryptedSignIn,
        refreshTokenEnc: encryptedSignIn,
        expiresAt,
      })
    }
  })

  return {
    pages: pages.length,
    instagram: instagramAccounts.size,
    expiresAt: expiresAt?.toISOString() ?? null,
  }
}

/** Says which app a Page or Instagram account promotes; null stops tracking it. */
export async function assignMetaAccount(
  db: Db,
  input: { connectionId: string; appId: string | null },
): Promise<{ provider: string; appId: string | null }> {
  const [connection] = await db
    .select({ id: connections.id, provider: connections.provider })
    .from(connections)
    .where(and(eq(connections.id, input.connectionId), inArray(connections.provider, [...META_PROVIDERS])))
    .limit(1)
  if (!connection) throw new ConnectInputError('That account is no longer connected. Reload the page.')

  if (input.appId !== null) {
    const [app] = await db.select({ id: apps.id }).from(apps).where(eq(apps.id, input.appId)).limit(1)
    if (!app) throw new ConnectInputError('That app no longer exists. Reload the page.')
  }

  await db
    .update(connections)
    .set({ appId: input.appId, updatedAt: new Date() })
    .where(eq(connections.id, connection.id))
  return { provider: connection.provider, appId: input.appId }
}
