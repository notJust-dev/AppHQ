import { and, eq, inArray } from 'drizzle-orm'
import { createMetaClient } from '../connectors/meta/client.js'
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

/**
 * Finishes a Facebook sign-in: trades the code for a long-lived user token and saves every Page
 * the person manages (with its Page token) and every Instagram account linked to one. They start
 * unassigned; Settings then says which app each promotes. Signing in again renews the tokens and
 * keeps those choices.
 *
 * Instagram accounts keep two tokens: the Page's, which does not expire, and the person's,
 * which lasts about 60 days. The connector tries the Page token first.
 */
export async function connectMeta(
  deps: { db: Db; secrets: Secrets; fetch?: typeof fetch; env?: NodeJS.ProcessEnv },
  input: { code: string; redirectUri: string },
): Promise<MetaConnectResult> {
  const config = requireMetaConfig(deps.env)
  // The code works once, so make sure the tokens can be stored before spending it.
  deps.secrets.encrypt('check')

  const client = createMetaClient({ config, fetch: deps.fetch })
  const short = await client.exchangeCode(input)
  const long = await client.longLived(short.access_token)
  const userToken = long.access_token
  const expiresAt = long.expires_in ? new Date(Date.now() + long.expires_in * 1000) : null

  const pages = (await client.pages(userToken)).filter((page) => page.access_token)
  if (pages.length === 0) {
    throw new ConnectInputError(
      'Facebook returned no Pages. Sign in again and select your Pages, and their Instagram ' +
        'accounts, when Facebook asks which ones to share.',
    )
  }

  const encryptedUser = deps.secrets.encrypt(userToken)
  let instagram = 0
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
      const pageToken = deps.secrets.encrypt(page.access_token ?? '')
      await save({
        provider: FACEBOOK,
        externalAccountId: page.id,
        displayName: page.name,
        accessTokenEnc: pageToken,
        refreshTokenEnc: null,
        expiresAt: null,
      })
      const account = page.instagram_business_account
      if (account) {
        instagram++
        await save({
          provider: INSTAGRAM,
          externalAccountId: account.id,
          displayName: account.username ? `@${account.username}` : (account.name ?? page.name),
          accessTokenEnc: pageToken,
          refreshTokenEnc: encryptedUser,
          expiresAt,
        })
      }
    }
  })

  return { pages: pages.length, instagram, expiresAt: expiresAt?.toISOString() ?? null }
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
