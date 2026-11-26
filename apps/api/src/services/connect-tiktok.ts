import { and, eq } from 'drizzle-orm'
import { createTikTokClient } from '../connectors/tiktok/client.js'
import { REQUIRED_SCOPES, TIKTOK, requireTikTokConfig } from '../connectors/tiktok/config.js'
import { upsertAssets } from '../assets/store.js'
import { apps, assets, connections } from '../db/schema.js'
import type { Secrets } from '../lib/crypto.js'
import type { Scope } from '../organizations/scope.js'
import { ConnectInputError } from './connect-app-store.js'

export interface TikTokConnectResult {
  appId: string
  appName: string
  /** How the account is shown: `@username`, or the display name. */
  account: string
}

/**
 * Finishes a TikTok sign-in: trades the code from the redirect for tokens, checks the person
 * granted what the dashboard needs, and stores the account, encrypted, against the app it
 * promotes. Connecting the same account again replaces its tokens and can move it to another app.
 */
export async function connectTikTok(
  deps: Scope & { secrets: Secrets; fetch?: typeof fetch; env?: NodeJS.ProcessEnv },
  input: { code: string; redirectUri: string; appId: string },
): Promise<TikTokConnectResult> {
  const config = requireTikTokConfig(deps.env)
  const [app] = await deps.run((db) =>
    db
      .select({ id: apps.id, name: apps.name })
      .from(apps)
      .where(and(eq(apps.organizationId, deps.organizationId), eq(apps.id, input.appId)))
      .limit(1),
  )
  if (!app) throw new ConnectInputError('That app no longer exists. Pick another and connect again.')

  // The code works once, so make sure the tokens can be stored before spending it.
  deps.secrets.encrypt('check')

  const client = createTikTokClient({ config, fetch: deps.fetch })
  const tokens = await client.exchangeCode({ code: input.code, redirectUri: input.redirectUri })

  const missing = REQUIRED_SCOPES.filter((scope) => !tokens.scopes.includes(scope))
  if (missing.length > 0) {
    await client.revoke(tokens.accessToken).catch(() => undefined)
    throw new ConnectInputError(
      `TikTok did not grant ${missing.join(' and ')}. Connect again and leave every ` +
        'permission switched on.',
    )
  }

  const user = await client.getUser(tokens.accessToken, tokens.scopes)
  const account = user.username ? `@${user.username}` : (user.display_name ?? 'TikTok account')

  const values = {
    displayName: account,
    accessTokenEnc: deps.secrets.encrypt(tokens.accessToken),
    refreshTokenEnc: deps.secrets.encrypt(tokens.refreshToken),
    expiresAt: tokens.expiresAt,
    refreshExpiresAt: tokens.refreshExpiresAt,
    scopes: tokens.scopes.join(','),
    status: 'ok',
    updatedAt: new Date(),
  }
  // TikTok has answered; the tokens, the account and its app are saved in one unit of work.
  await deps.run(async (db) => {
    const [connection] = await db
      .insert(connections)
      .values({ organizationId: deps.organizationId, provider: TIKTOK, externalAccountId: tokens.openId, ...values })
      .onConflictDoUpdate({
        target: [connections.organizationId, connections.provider, connections.externalAccountId],
        set: values,
      })
      .returning({ id: connections.id })
    if (!connection) throw new Error('could not save the TikTok connection')

    // The account goes to the app picked before signing in; connecting it again can move it.
    const [asset] = await upsertAssets(deps, [
      { kind: 'tiktok_account', externalId: tokens.openId, name: account, connectionId: connection.id },
    ])
    if (asset) {
      await db
        .update(assets)
        .set({ appId: app.id, ignored: false, updatedAt: new Date() })
        .where(and(eq(assets.organizationId, deps.organizationId), eq(assets.id, asset.id)))
    }
  })

  return { appId: app.id, appName: app.name, account }
}
