export const TIKTOK = 'tiktok'

/**
 * What the dashboard asks a TikTok account for. Each scope has to be added to the TikTok app (or
 * its sandbox) first, or the sign-in fails with `invalid_scope`.
 */
export const TIKTOK_SCOPES = [
  'user.info.basic',
  'user.info.profile',
  'user.info.stats',
  'video.list',
] as const

/** Without these the account is no use: there would be nothing to read. */
export const REQUIRED_SCOPES = ['user.info.basic', 'video.list'] as const

export interface TikTokConfig {
  clientKey: string
  clientSecret: string
  /** Display API and OAuth token host. */
  apiUrl: string
  /** Where the browser is sent to sign in. */
  authorizeUrl: string
}

export class TikTokNotConfiguredError extends Error {
  constructor() {
    super(
      'TikTok is not set up on the API yet. Set TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET on ' +
        'the api app, from the TikTok app or sandbox you created.',
    )
    this.name = 'TikTokNotConfiguredError'
  }
}

/**
 * The TikTok app's credentials, or null when they are not set. The two URLs can be pointed at a
 * local stand-in, so the whole flow runs without a TikTok account.
 */
export function tiktokConfig(env: NodeJS.ProcessEnv = process.env): TikTokConfig | null {
  const clientKey = env.TIKTOK_CLIENT_KEY?.trim()
  const clientSecret = env.TIKTOK_CLIENT_SECRET?.trim()
  if (!clientKey || !clientSecret) return null
  return {
    clientKey,
    clientSecret,
    apiUrl: env.TIKTOK_API_URL?.trim() || 'https://open.tiktokapis.com',
    authorizeUrl: env.TIKTOK_AUTH_URL?.trim() || 'https://www.tiktok.com/v2/auth/authorize/',
  }
}

export function requireTikTokConfig(env?: NodeJS.ProcessEnv): TikTokConfig {
  const config = tiktokConfig(env)
  if (!config) throw new TikTokNotConfiguredError()
  return config
}
