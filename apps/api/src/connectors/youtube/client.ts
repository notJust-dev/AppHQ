import { z } from 'zod'
import type { IsoDate } from '../../lib/dates.js'
import { YOUTUBE_SCOPES, type YouTubeConfig } from './config.js'

const MAX_PAGES = 40

export class YouTubeError extends Error {
  constructor(
    readonly status: number,
    /** Google's error, e.g. `invalid_grant`, or a reason such as `quotaExceeded`. */
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'YouTubeError'
  }

  get isAuthProblem(): boolean {
    return this.status === 401 || this.code === 'invalid_grant'
  }
}

const tokenResponse = z.object({
  access_token: z.string(),
  expires_in: z.number().optional(),
  refresh_token: z.string().optional(),
  scope: z.string().optional(),
})

const channelsResponse = z.object({
  items: z
    .array(
      z.object({
        id: z.string(),
        snippet: z.object({ title: z.string(), customUrl: z.string().optional() }).optional(),
        statistics: z
          .object({ subscriberCount: z.string().optional(), hiddenSubscriberCount: z.boolean().optional() })
          .optional(),
        contentDetails: z.object({ relatedPlaylists: z.object({ uploads: z.string().optional() }) }).optional(),
      }),
    )
    .optional(),
})

const playlistResponse = z.object({
  items: z
    .array(z.object({ contentDetails: z.object({ videoId: z.string(), videoPublishedAt: z.string().optional() }) }))
    .optional(),
  nextPageToken: z.string().optional(),
})

const videosResponse = z.object({
  items: z
    .array(
      z.object({
        id: z.string(),
        snippet: z.object({ title: z.string().optional(), publishedAt: z.string() }),
        statistics: z
          .object({ viewCount: z.string().optional(), likeCount: z.string().optional(), commentCount: z.string().optional() })
          .optional(),
        contentDetails: z.object({ duration: z.string().optional() }).optional(),
      }),
    )
    .optional(),
})

const reportResponse = z.object({
  columnHeaders: z.array(z.object({ name: z.string() })),
  rows: z.array(z.array(z.union([z.string(), z.number()]))).optional(),
})

export interface YouTubeChannel {
  id: string
  title: string
  handle: string | null
  subscribers: number | null
  uploadsPlaylistId: string | null
}

export interface YouTubeVideo {
  id: string
  title: string | null
  publishedAt: Date
  durationSeconds: number | null
  views: number
  likes: number
  comments: number
}

/** PT1H2M3S as seconds. */
export function parseDuration(value: string | undefined): number | null {
  const match = value ? /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(value) : null
  if (!match) return null
  const [, days, hours, minutes, seconds] = match.map((part) => Number(part ?? 0))
  return (days ?? 0) * 86_400 + (hours ?? 0) * 3600 + (minutes ?? 0) * 60 + (seconds ?? 0)
}

const count = (value: string | undefined) => (value === undefined ? 0 : Number(value) || 0)

/**
 * Google sign-in for a YouTube channel, and the three things read from it: the channel itself,
 * its uploads with their totals (Data API), and its daily numbers (Analytics API).
 */
export function createYouTubeClient(options: { config: YouTubeConfig; fetch?: typeof fetch }) {
  const { config } = options
  const doFetch = options.fetch ?? fetch

  async function failure(response: Response): Promise<never> {
    const body = (await response.json().catch(() => null)) as {
      error?: string | { message?: string; errors?: { reason?: string }[] }
      error_description?: string
    } | null
    if (typeof body?.error === 'string') {
      throw new YouTubeError(response.status, body.error, body.error_description || body.error)
    }
    const reason = body?.error?.errors?.[0]?.reason ?? `http_${response.status}`
    throw new YouTubeError(response.status, reason, body?.error?.message || `Google answered ${response.status}`)
  }

  async function token(params: Record<string, string>) {
    const response = await doFetch(config.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, ...params }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok) return failure(response)
    return tokenResponse.parse(await response.json())
  }

  async function get(url: string, accessToken: string): Promise<unknown> {
    const response = await doFetch(url, {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(60_000),
    })
    if (!response.ok) return failure(response)
    return response.json()
  }

  return {
    authorizeUrl(input: { redirectUri: string; state: string }): string {
      const url = new URL(config.authUrl)
      url.search = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: input.redirectUri,
        response_type: 'code',
        scope: YOUTUBE_SCOPES.join(' '),
        // A refresh token, every time, so syncs keep working after the hour-long access token.
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: 'true',
        state: input.state,
      }).toString()
      return url.toString()
    },

    exchangeCode: (input: { code: string; redirectUri: string }) =>
      token({ grant_type: 'authorization_code', code: input.code, redirect_uri: input.redirectUri }),

    refresh: (refreshToken: string) => token({ grant_type: 'refresh_token', refresh_token: refreshToken }),

    /** The channel the sign-in chose. */
    async myChannel(accessToken: string): Promise<YouTubeChannel | null> {
      const url = `${config.dataUrl}/channels?part=snippet,statistics,contentDetails&mine=true`
      const channel = channelsResponse.parse(await get(url, accessToken)).items?.[0]
      if (!channel) return null
      const hidden = channel.statistics?.hiddenSubscriberCount === true
      return {
        id: channel.id,
        title: channel.snippet?.title ?? channel.id,
        handle: channel.snippet?.customUrl ?? null,
        subscribers: hidden || channel.statistics?.subscriberCount === undefined ? null : count(channel.statistics.subscriberCount),
        uploadsPlaylistId: channel.contentDetails?.relatedPlaylists.uploads ?? null,
      }
    },

    /** The channel's videos published since `since`, newest first, with their lifetime totals. */
    async videosSince(accessToken: string, uploadsPlaylistId: string, since: Date): Promise<YouTubeVideo[]> {
      const ids: string[] = []
      let pageToken: string | undefined
      for (let page = 0; page < MAX_PAGES; page++) {
        const url = new URL(`${config.dataUrl}/playlistItems`)
        url.search = new URLSearchParams({
          part: 'contentDetails',
          playlistId: uploadsPlaylistId,
          maxResults: '50',
          ...(pageToken ? { pageToken } : {}),
        }).toString()
        const parsed = playlistResponse.parse(await get(url.toString(), accessToken))
        let older = false
        for (const item of parsed.items ?? []) {
          const published = item.contentDetails.videoPublishedAt
          if (published && new Date(published) < since) older = true
          else ids.push(item.contentDetails.videoId)
        }
        pageToken = parsed.nextPageToken
        if (older || !pageToken) break
      }

      const videos: YouTubeVideo[] = []
      for (let i = 0; i < ids.length; i += 50) {
        const url = `${config.dataUrl}/videos?part=snippet,statistics,contentDetails&id=${ids.slice(i, i + 50).join(',')}`
        for (const video of videosResponse.parse(await get(url, accessToken)).items ?? []) {
          videos.push({
            id: video.id,
            title: video.snippet.title ?? null,
            publishedAt: new Date(video.snippet.publishedAt),
            durationSeconds: parseDuration(video.contentDetails?.duration),
            views: count(video.statistics?.viewCount),
            likes: count(video.statistics?.likeCount),
            comments: count(video.statistics?.commentCount),
          })
        }
      }
      return videos
    },

    /** Views, likes, comments and shares per day across the whole channel. */
    async daily(accessToken: string, from: IsoDate, to: IsoDate) {
      const url = new URL(`${config.analyticsUrl}/reports`)
      url.search = new URLSearchParams({
        ids: 'channel==MINE',
        startDate: from,
        endDate: to,
        metrics: 'views,likes,comments,shares',
        dimensions: 'day',
        sort: 'day',
      }).toString()
      const report = reportResponse.parse(await get(url.toString(), accessToken))
      const column = (name: string) => report.columnHeaders.findIndex((header) => header.name === name)
      const [day, views, likes, comments, shares] = ['day', 'views', 'likes', 'comments', 'shares'].map(column)
      const number = (row: (string | number)[], index: number | undefined) =>
        index === undefined || index < 0 ? 0 : Number(row[index] ?? 0)
      return (report.rows ?? []).map((row) => ({
        date: String(row[day ?? 0]),
        views: number(row, views),
        likes: number(row, likes),
        comments: number(row, comments),
        shares: number(row, shares),
      }))
    },
  }
}

export type YouTubeClient = ReturnType<typeof createYouTubeClient>
