import { autoLink, upsertAssets } from '../assets/store.js'
import { createYouTubeClient } from '../connectors/youtube/client.js'
import { YOUTUBE, requireYouTubeConfig } from '../connectors/youtube/config.js'
import type { Db } from '../db/client.js'
import { connections } from '../db/schema.js'
import type { Secrets } from '../lib/crypto.js'
import { ConnectInputError } from './connect-app-store.js'

export interface YouTubeConnectResult {
  channel: string
  channelId: string
}

/**
 * Finishes a Google sign-in for a YouTube channel: keeps the refresh token (encrypted) so syncs
 * outlive the hour-long access token, and saves the channel as a social account waiting for
 * an app. Signing in again renews the tokens and keeps the app it was given. A Google account
 * with several channels picks one at sign-in; sign in again for each of the others.
 */
export async function connectYouTube(
  deps: { db: Db; secrets: Secrets; fetch?: typeof fetch; env?: NodeJS.ProcessEnv },
  input: { code: string; redirectUri: string },
): Promise<YouTubeConnectResult> {
  const config = requireYouTubeConfig(deps.env)
  // The code works once, so make sure the tokens can be stored before spending it.
  deps.secrets.encrypt('check')

  const client = createYouTubeClient({ config, fetch: deps.fetch })
  const tokens = await client.exchangeCode(input)
  if (!tokens.refresh_token) {
    throw new ConnectInputError(
      'Google did not hand over a refresh token. Remove the dashboard from your Google account’s third-party ' +
        'access, then connect again.',
    )
  }
  const channel = await client.myChannel(tokens.access_token)
  if (!channel) {
    throw new ConnectInputError('This Google account has no YouTube channel. Sign in with the account, or brand account, that owns it.')
  }

  const values = {
    displayName: channel.handle ?? channel.title,
    accessTokenEnc: deps.secrets.encrypt(tokens.access_token),
    refreshTokenEnc: deps.secrets.encrypt(tokens.refresh_token),
    expiresAt: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null,
    scopes: tokens.scope?.split(' ').join(',') ?? null,
    details: { uploadsPlaylistId: channel.uploadsPlaylistId, title: channel.title },
    status: 'ok',
    updatedAt: new Date(),
  }
  const [connection] = await deps.db
    .insert(connections)
    .values({ provider: YOUTUBE, externalAccountId: channel.id, ...values })
    .onConflictDoUpdate({ target: [connections.provider, connections.externalAccountId], set: values })
    .returning()
  if (!connection) throw new Error('could not save the YouTube connection')

  await upsertAssets(deps.db, [
    {
      kind: 'youtube_channel',
      externalId: channel.id,
      name: channel.handle ?? channel.title,
      connectionId: connection.id,
      details: { title: channel.title },
    },
  ])
  await autoLink(deps.db)
  return { channel: channel.handle ?? channel.title, channelId: channel.id }
}
