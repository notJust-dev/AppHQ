import { autoLink, upsertAssets, type AssetInput } from '../assets/store.js'
import { MetaError, createMetaClient, type MetaPage } from '../connectors/meta/client.js'
import { ESSENTIAL_PERMISSIONS, FACEBOOK, INSTAGRAM, requireMetaConfig } from '../connectors/meta/config.js'
import { connections } from '../db/schema.js'
import type { Secrets } from '../lib/crypto.js'
import type { Scope } from '../organizations/scope.js'
import { ConnectInputError } from './connect-app-store.js'

export interface MetaConnectResult {
  pages: number
  instagram: number
  /** When the sign-in, and with it Instagram, has to be renewed. */
  expiresAt: string | null
  /**
   * Essential permissions the sign-in did not get, usually because the login configuration in
   * the Meta app lacks them. Empty when all are there, or when Meta would not say.
   */
  missing: string[]
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
  deps: Scope & { secrets: Secrets; fetch?: typeof fetch; env?: NodeJS.ProcessEnv },
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

  // Which permissions the sign-in really got. Not knowing is not a reason to fail the connection.
  const granted = await client
    .debugToken(signInToken)
    .then((info) => info.scopes ?? null)
    .catch(() => null)
  const missing = granted ? ESSENTIAL_PERMISSIONS.filter((scope) => !granted.includes(scope)) : []

  const pages = (await client.pages(signInToken).catch(unlessRefused<MetaPage>)).filter(
    (page) => page.access_token,
  )
  const instagramAccounts = new Map<
    string,
    { username?: string; name?: string; pageToken?: string; pageName?: string; pageId?: string }
  >()
  for (const page of pages) {
    const account = page.instagram_business_account
    if (account) {
      instagramAccounts.set(account.id, {
        ...account,
        pageToken: page.access_token,
        pageName: page.name,
        pageId: page.id,
      })
    }
  }
  for (const account of await client
    .assignedInstagramAccounts(signInToken)
    .catch(unlessRefused<{ id: string; username?: string }>)) {
    if (!instagramAccounts.has(account.id)) instagramAccounts.set(account.id, account)
  }

  if (pages.length === 0 && instagramAccounts.size === 0) {
    throw new ConnectInputError(
      missing.length > 0
        ? `Facebook returned no Pages or Instagram accounts, and the sign-in lacks ${missing.join(', ')}. ` +
            'Add them to the login configuration in the Meta app, then connect again.'
        : 'Facebook returned no Pages or Instagram accounts. Sign in again and select them when ' +
            'Facebook asks which ones to share.',
    )
  }

  const encryptedSignIn = deps.secrets.encrypt(signInToken)
  const found: AssetInput[] = []
  // Facebook has answered everything; saving is one unit of work.
  await deps.run(async (tx) => {
    const save = async (row: {
      provider: string
      externalAccountId: string
      displayName: string
      accessTokenEnc: string
      refreshTokenEnc: string | null
      expiresAt: Date | null
    }) => {
      const values = { ...row, scopes: granted?.join(',') ?? null, status: 'ok', updatedAt: new Date() }
      const [saved] = await tx
        .insert(connections)
        .values({ ...values, organizationId: deps.organizationId })
        .onConflictDoUpdate({ target: [connections.organizationId, connections.provider, connections.externalAccountId], set: values })
        .returning({ id: connections.id })
      if (!saved) throw new Error('could not save a Meta connection')
      return saved.id
    }

    for (const page of pages) {
      const connectionId = await save({
        provider: FACEBOOK,
        externalAccountId: page.id,
        displayName: page.name,
        accessTokenEnc: deps.secrets.encrypt(page.access_token ?? ''),
        refreshTokenEnc: null,
        expiresAt: null,
      })
      found.push({ kind: 'facebook_page', externalId: page.id, name: page.name, connectionId })
    }
    for (const [id, account] of instagramAccounts) {
      const name = account.username ? `@${account.username}` : (account.name ?? account.pageName ?? 'Instagram account')
      const connectionId = await save({
        provider: INSTAGRAM,
        externalAccountId: id,
        displayName: name,
        // Without a linked Page the sign-in token is the only one, so it fills both places.
        accessTokenEnc: account.pageToken ? deps.secrets.encrypt(account.pageToken) : encryptedSignIn,
        refreshTokenEnc: encryptedSignIn,
        expiresAt,
      })
      found.push({
        kind: 'instagram_account',
        externalId: id,
        name,
        connectionId,
        details: account.pageId ? { pageId: account.pageId } : null,
      })
    }
  })

  // New Pages and accounts wait for an app to be chosen; one linked to a Page that already has
  // its app follows the Page. Reconnecting keeps every choice made before.
  await upsertAssets(deps, found)
  await autoLink(deps)

  return {
    pages: pages.length,
    instagram: instagramAccounts.size,
    expiresAt: expiresAt?.toISOString() ?? null,
    missing,
  }
}
