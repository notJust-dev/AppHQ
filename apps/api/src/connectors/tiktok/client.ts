import { z } from 'zod'
import { TIKTOK_SCOPES, type TikTokConfig } from './config.js'

/**
 * Minimal client for TikTok's Login Kit (web) and Display API v2: sign-in, token refresh, the
 * user's profile and stats, and their public videos with lifetime totals.
 *
 * TikTok answers in two shapes. The OAuth endpoints return `{ error, error_description }`; the
 * Display API returns `{ data, error: { code, message, log_id } }` with code "ok" on success.
 */

const MAX_ATTEMPTS = 3
/** 20 videos per page, so up to 2,000 videos per account. */
const MAX_PAGES = 100
const PAGE_SIZE = 20

/** Error codes that mean the account's authorisation is gone, not that TikTok is unwell. */
const AUTH_CODES = new Set(['access_token_invalid', 'scope_not_authorized', 'invalid_grant'])

export class TikTokError extends Error {
  constructor(
    readonly status: number,
    /** TikTok's error code, e.g. `access_token_invalid` or, from OAuth, `invalid_grant`. */
    readonly code: string,
    message: string,
    readonly logId?: string,
  ) {
    super(message)
    this.name = 'TikTokError'
  }

  /** The account has to be connected again. */
  get isAuthProblem(): boolean {
    return AUTH_CODES.has(this.code)
  }
}

const oauthError = z.object({
  error: z.string(),
  error_description: z.string().nullish(),
  log_id: z.string().nullish(),
})

const tokenSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number(),
  refresh_token: z.string().min(1),
  refresh_expires_in: z.number().nullish(),
  open_id: z.string().min(1),
  scope: z.string().nullish(),
})

const apiError = z.object({
  code: z.string(),
  message: z.string().nullish(),
  log_id: z.string().nullish(),
})

const envelope = z.object({ data: z.unknown().optional(), error: apiError.optional() })

const userSchema = z.object({
  open_id: z.string(),
  display_name: z.string().nullish(),
  username: z.string().nullish(),
  avatar_url: z.string().nullish(),
  follower_count: z.number().nullish(),
  likes_count: z.number().nullish(),
  video_count: z.number().nullish(),
})

const videoSchema = z.object({
  id: z.string(),
  /** Unix seconds. */
  create_time: z.number(),
  title: z.string().nullish(),
  video_description: z.string().nullish(),
  share_url: z.string().nullish(),
  duration: z.number().nullish(),
  view_count: z.number().nullish(),
  like_count: z.number().nullish(),
  comment_count: z.number().nullish(),
  share_count: z.number().nullish(),
})

const videoPage = z.object({
  videos: z.array(videoSchema).nullish(),
  cursor: z.number().nullish(),
  has_more: z.boolean().nullish(),
})

const VIDEO_FIELDS = [
  'id',
  'create_time',
  'title',
  'video_description',
  'share_url',
  'duration',
  'view_count',
  'like_count',
  'comment_count',
  'share_count',
]

export interface TikTokTokens {
  accessToken: string
  refreshToken: string
  expiresAt: Date
  /** Null when TikTok did not say; the docs give 180 days. */
  refreshExpiresAt: Date | null
  openId: string
  /** The scopes the person actually granted, which can be fewer than were asked for. */
  scopes: string[]
}

export type TikTokUser = z.infer<typeof userSchema>
export type TikTokVideo = z.infer<typeof videoSchema>

export interface TikTokClientOptions {
  config: TikTokConfig
  fetch?: typeof fetch
  /** Replaced in tests so rate-limit retries do not actually wait. */
  sleep?: (ms: number) => Promise<void>
  now?: () => Date
}

export function createTikTokClient(options: TikTokClientOptions) {
  const { config } = options
  const doFetch = options.fetch ?? fetch
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)))
  const now = options.now ?? (() => new Date())

  /** Sends a request, retrying a 429 after the wait TikTok asks for. */
  async function send(url: URL, init: RequestInit): Promise<{ status: number; body: unknown }> {
    for (let attempt = 1; ; attempt++) {
      const response = await doFetch(url, { ...init, signal: AbortSignal.timeout(30_000) })
      const body: unknown = await response.json().catch(() => null)
      if (response.status === 429 && attempt < MAX_ATTEMPTS) {
        const seconds = Number(response.headers.get('retry-after'))
        await sleep(seconds > 0 ? Math.min(seconds * 1000, 60_000) : 5_000)
        continue
      }
      return { status: response.status, body }
    }
  }

  /** The OAuth token endpoint: form-encoded in, tokens or `{ error }` out. */
  async function token(fields: Record<string, string>): Promise<TikTokTokens> {
    const url = new URL('/v2/oauth/token/', config.apiUrl)
    const { status, body } = await send(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'cache-control': 'no-cache',
      },
      body: new URLSearchParams({
        client_key: config.clientKey,
        client_secret: config.clientSecret,
        ...fields,
      }),
    })

    const tokens = tokenSchema.safeParse(body)
    if (status < 400 && tokens.success) {
      const issued = now().getTime()
      return {
        accessToken: tokens.data.access_token,
        refreshToken: tokens.data.refresh_token,
        expiresAt: new Date(issued + tokens.data.expires_in * 1000),
        refreshExpiresAt: tokens.data.refresh_expires_in
          ? new Date(issued + tokens.data.refresh_expires_in * 1000)
          : null,
        openId: tokens.data.open_id,
        scopes: (tokens.data.scope ?? '').split(',').map((s) => s.trim()).filter(Boolean),
      }
    }
    const error = oauthError.safeParse(body).data
    throw new TikTokError(
      status,
      error?.error ?? 'unexpected_response',
      error?.error_description || `TikTok's token endpoint answered ${status}`,
      error?.log_id ?? undefined,
    )
  }

  /** A Display API call: bearer token in, `data` out when `error.code` is "ok". */
  async function display(
    accessToken: string,
    path: string,
    fields: string[],
    json?: unknown,
  ): Promise<unknown> {
    const url = new URL(path, config.apiUrl)
    url.searchParams.set('fields', fields.join(','))
    const { status, body } = await send(url, {
      method: json === undefined ? 'GET' : 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        ...(json === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: json === undefined ? undefined : JSON.stringify(json),
    })

    const parsed = envelope.safeParse(body)
    const error = parsed.data?.error
    if (status < 400 && parsed.success && (!error || error.code === 'ok')) return parsed.data.data
    throw new TikTokError(
      status,
      error?.code ?? 'unexpected_response',
      error?.message || `TikTok answered ${status}`,
      error?.log_id ?? undefined,
    )
  }

  return {
    /** Where to send the browser. TikTok sends it back to `redirectUri` with `code` and `state`. */
    authorizeUrl(params: { redirectUri: string; state: string }): string {
      const url = new URL(config.authorizeUrl)
      url.searchParams.set('client_key', config.clientKey)
      url.searchParams.set('scope', TIKTOK_SCOPES.join(','))
      url.searchParams.set('response_type', 'code')
      url.searchParams.set('redirect_uri', params.redirectUri)
      url.searchParams.set('state', params.state)
      return url.toString()
    },

    /** Trades the one-time code from the redirect for tokens. `redirectUri` must match exactly. */
    exchangeCode(params: { code: string; redirectUri: string }) {
      return token({
        code: params.code,
        grant_type: 'authorization_code',
        redirect_uri: params.redirectUri,
      })
    },

    /**
     * Gets a new access token. TikTok also issues a new refresh token and the one sent stops
     * working, so the result must be saved before anything else happens.
     */
    refresh(refreshToken: string) {
      return token({ grant_type: 'refresh_token', refresh_token: refreshToken })
    },

    /** Best effort: used when an account is connected without the scopes it needs. */
    async revoke(accessToken: string): Promise<void> {
      const url = new URL('/v2/oauth/revoke/', config.apiUrl)
      await send(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_key: config.clientKey,
          client_secret: config.clientSecret,
          token: accessToken,
        }),
      })
    },

    /**
     * The account's profile, plus its counts when `user.info.stats` was granted. Asking for a
     * field whose scope was not granted fails the whole call, so fields follow the scopes.
     */
    async getUser(accessToken: string, scopes: readonly string[]): Promise<TikTokUser> {
      const fields = ['open_id', 'display_name', 'avatar_url']
      if (scopes.includes('user.info.profile')) fields.push('username')
      if (scopes.includes('user.info.stats')) {
        fields.push('follower_count', 'likes_count', 'video_count')
      }
      const data = z
        .object({ user: userSchema })
        .parse(await display(accessToken, '/v2/user/info/', fields))
      return data.user
    },

    /** Every public video of the account, newest first, with lifetime totals. */
    async listVideos(accessToken: string): Promise<TikTokVideo[]> {
      const videos: TikTokVideo[] = []
      let cursor: number | undefined
      for (let page = 0; page < MAX_PAGES; page++) {
        const data = videoPage.parse(
          await display(accessToken, '/v2/video/list/', VIDEO_FIELDS, {
            max_count: PAGE_SIZE,
            ...(cursor === undefined ? {} : { cursor }),
          }),
        )
        videos.push(...(data.videos ?? []))
        if (!data.has_more || data.cursor === null || data.cursor === undefined) break
        // A cursor that does not move would loop forever.
        if (data.cursor === cursor) break
        cursor = data.cursor
      }
      return videos
    },
  }
}

export type TikTokClient = ReturnType<typeof createTikTokClient>
