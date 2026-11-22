export const YOUTUBE = 'youtube'

/** Reading a channel's videos and its analytics; nothing that can change the channel. */
export const YOUTUBE_SCOPES = [
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
] as const

export interface YouTubeConfig {
  clientId: string
  clientSecret: string
  authUrl: string
  tokenUrl: string
  dataUrl: string
  analyticsUrl: string
}

export class YouTubeNotConfiguredError extends Error {
  constructor() {
    super(
      'YouTube is not set up on the API yet. Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET ' +
        'on the api app, from an OAuth client in Google Cloud.',
    )
    this.name = 'YouTubeNotConfiguredError'
  }
}

/** The Google OAuth client's credentials, or null when they are not set. The URLs can point at a stand-in. */
export function youtubeConfig(env: NodeJS.ProcessEnv = process.env): YouTubeConfig | null {
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID?.trim()
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET?.trim()
  if (!clientId || !clientSecret) return null
  return {
    clientId,
    clientSecret,
    authUrl: env.GOOGLE_AUTH_URL?.trim() || 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: env.GOOGLE_TOKEN_URL?.trim() || 'https://oauth2.googleapis.com/token',
    dataUrl: env.YOUTUBE_DATA_URL?.trim() || 'https://www.googleapis.com/youtube/v3',
    analyticsUrl: env.YOUTUBE_ANALYTICS_URL?.trim() || 'https://youtubeanalytics.googleapis.com/v2',
  }
}

export function requireYouTubeConfig(env?: NodeJS.ProcessEnv): YouTubeConfig {
  const config = youtubeConfig(env)
  if (!config) throw new YouTubeNotConfiguredError()
  return config
}
