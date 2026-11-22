import { createHmac } from 'node:crypto'
import { z } from 'zod'
import { GRAPH_VERSION, META_PERMISSIONS, type MetaConfig } from './config.js'
import { pacificWindow, parseMetaTime } from './days.js'
import type { IsoDate } from '../../lib/dates.js'

/**
 * Minimal client for the Facebook Graph API: Facebook Login for Business, the Pages a person
 * manages with their linked Instagram accounts, Page insights, Page posts and reels, and
 * Instagram account and media insights.
 */

/** Pages of a list are followed up to this many times (100 items each). */
const MAX_PAGES = 30
/** Meta allows at most 90 days per insights request. */
const MAX_INSIGHT_DAYS = 90

const RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80001, 80002])

export class MetaError extends Error {
  constructor(
    readonly status: number,
    /** Graph API error code, e.g. 190 for a token that no longer works. */
    readonly code: number,
    readonly subcode: number | undefined,
    message: string,
    readonly traceId?: string,
  ) {
    super(message)
    this.name = 'MetaError'
  }

  /** The sign-in is gone (expired, revoked, password changed): connect again. */
  get isAuthProblem(): boolean {
    return this.code === 190 || this.code === 102
  }

  /** The token works but is not allowed this call. */
  get isPermissionProblem(): boolean {
    return this.code === 10 || (this.code >= 200 && this.code < 300)
  }

  get isRateLimit(): boolean {
    return RATE_LIMIT_CODES.has(this.code)
  }
}

const errorBody = z.object({
  error: z.object({
    message: z.string().optional(),
    code: z.number().optional(),
    error_subcode: z.number().optional(),
    fbtrace_id: z.string().optional(),
  }),
})

const tokenSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().optional(),
})

const paging = z.object({ next: z.string().optional() }).optional()

const pageSchema = z.object({
  id: z.string(),
  name: z.string(),
  access_token: z.string().optional(),
  instagram_business_account: z
    .object({ id: z.string(), username: z.string().optional(), name: z.string().optional() })
    .optional(),
})

const insightValue = z.object({
  value: z.union([z.number(), z.record(z.string(), z.number())]).optional(),
  end_time: z.string().optional(),
})

const insightSeries = z.object({
  name: z.string(),
  values: z.array(insightValue).optional(),
  total_value: z.object({ value: z.number() }).optional(),
})

const summaryCount = z.object({ summary: z.object({ total_count: z.number() }).optional() }).optional()

const postSchema = z.object({
  id: z.string(),
  created_time: z.string(),
  message: z.string().optional(),
  permalink_url: z.string().optional(),
  reactions: summaryCount,
  comments: summaryCount,
  shares: z.object({ count: z.number() }).optional(),
})

const reelSchema = z.object({
  id: z.string(),
  created_time: z.string().optional(),
  updated_time: z.string().optional(),
  description: z.string().optional(),
  permalink_url: z.string().optional(),
  length: z.number().optional(),
})

const igAccountSchema = z.object({
  id: z.string(),
  username: z.string().optional(),
  followers_count: z.number().optional(),
})

const mediaSchema = z.object({
  id: z.string(),
  caption: z.string().optional(),
  media_type: z.string().optional(),
  media_product_type: z.string().optional(),
  permalink: z.string().optional(),
  timestamp: z.string(),
  like_count: z.number().optional(),
  comments_count: z.number().optional(),
})

export type MetaPage = z.infer<typeof pageSchema>
export type PagePost = z.infer<typeof postSchema>
export type PageReel = z.infer<typeof reelSchema>
export type InstagramMedia = z.infer<typeof mediaSchema>

/** A daily value as Meta reports it: the day it ends and the number. */
export interface DailyPoint {
  endTime: string
  value: number
}

export interface MetaClientOptions {
  config: MetaConfig
  fetch?: typeof fetch
}

export function createMetaClient(options: MetaClientOptions) {
  const { config } = options
  const doFetch = options.fetch ?? fetch
  const base = `${config.graphUrl.replace(/\/$/, '')}/${GRAPH_VERSION}`

  /** Proves the call comes from the app's server; required when the app enables it. */
  const proof = (token: string) => createHmac('sha256', config.appSecret).update(token).digest('hex')

  async function getUrl(url: URL): Promise<unknown> {
    const response = await doFetch(url, { signal: AbortSignal.timeout(30_000) })
    const body: unknown = await response.json().catch(() => null)
    const error = errorBody.safeParse(body)
    if (response.ok && !error.success) return body
    const detail = error.data?.error
    throw new MetaError(
      response.status,
      detail?.code ?? 0,
      detail?.error_subcode,
      detail?.message || `Meta answered ${response.status}`,
      detail?.fbtrace_id,
    )
  }

  function graph(path: string, token: string, params: Record<string, string | number> = {}) {
    const url = new URL(`${base}${path}`)
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value))
    url.searchParams.set('access_token', token)
    url.searchParams.set('appsecret_proof', proof(token))
    return getUrl(url)
  }

  /** Every item of a list, following `paging.next` until `stop` says enough. */
  async function list<T extends z.ZodType>(
    item: T,
    first: Promise<unknown>,
    stop: (last: z.infer<T>) => boolean = () => false,
  ): Promise<z.infer<T>[]> {
    const schema = z.object({ data: z.array(item), paging })
    const items: z.infer<T>[] = []
    let body = await first
    for (let page = 0; page < MAX_PAGES; page++) {
      const parsed = schema.parse(body)
      items.push(...parsed.data)
      const last = parsed.data.at(-1)
      if (!parsed.paging?.next || last === undefined || stop(last)) break
      body = await getUrl(new URL(parsed.paging.next))
    }
    return items
  }

  async function token(params: Record<string, string>) {
    const url = new URL(`${base}/oauth/access_token`)
    for (const [key, value] of Object.entries({
      client_id: config.appId,
      client_secret: config.appSecret,
      ...params,
    })) {
      url.searchParams.set(key, value)
    }
    return tokenSchema.parse(await getUrl(url))
  }

  return {
    /** Where to send the browser; Facebook sends it back to `redirectUri` with `code` and `state`. */
    authorizeUrl(params: { redirectUri: string; state: string }): string {
      const url = new URL(`${config.dialogUrl.replace(/\/$/, '')}/${GRAPH_VERSION}/dialog/oauth`)
      url.searchParams.set('client_id', config.appId)
      url.searchParams.set('redirect_uri', params.redirectUri)
      url.searchParams.set('state', params.state)
      url.searchParams.set('response_type', 'code')
      if (config.loginConfigId) url.searchParams.set('config_id', config.loginConfigId)
      else url.searchParams.set('scope', META_PERMISSIONS.join(','))
      return url.toString()
    },

    /** The code from the redirect, traded for a short-lived user token. */
    exchangeCode: (params: { code: string; redirectUri: string }) =>
      token({ code: params.code, redirect_uri: params.redirectUri }),

    /** A short-lived user token traded for one that lasts about 60 days. */
    longLived: (shortToken: string) =>
      token({ grant_type: 'fb_exchange_token', fb_exchange_token: shortToken }),

    /**
     * What a token is and which permissions it actually carries, asked with the app's own token.
     * The sign-in can grant fewer permissions than the configuration lists.
     */
    async debugToken(token: string) {
      const appToken = `${config.appId}|${config.appSecret}`
      const parsed = z
        .object({
          data: z.object({
            type: z.string().optional(),
            is_valid: z.boolean().optional(),
            expires_at: z.number().optional(),
            scopes: z.array(z.string()).optional(),
          }),
        })
        .parse(await graph('/debug_token', appToken, { input_token: token }))
      return parsed.data
    },

    async me(userToken: string) {
      return z.object({ id: z.string(), name: z.string().optional() }).parse(
        await graph('/me', userToken, { fields: 'id,name' }),
      )
    },

    /** The Pages the person manages, each with a Page token and its linked Instagram account. */
    pages: (userToken: string) =>
      list(
        pageSchema,
        graph('/me/accounts', userToken, {
          fields: 'id,name,access_token,instagram_business_account{id,username,name}',
          limit: 100,
        }),
      ),

    /** One daily Page metric over whole Pacific days, in requests of at most 90 days. */
    async pageMetric(pageToken: string, pageId: string, metric: string, from: IsoDate, to: IsoDate) {
      const points: DailyPoint[] = []
      for (const chunk of chunks(from, to, MAX_INSIGHT_DAYS)) {
        const window = pacificWindow(chunk.from, chunk.to)
        const parsed = z.object({ data: z.array(insightSeries) }).parse(
          await graph(`/${pageId}/insights`, pageToken, { metric, period: 'day', ...window }),
        )
        for (const value of parsed.data[0]?.values ?? []) {
          if (typeof value.value === 'number' && value.end_time) {
            points.push({ endTime: value.end_time, value: value.value })
          }
        }
      }
      return points
    },

    /**
     * Posts published since `since` (Unix seconds), newest first, with reaction, comment and
     * share counts. If the Page refuses the counts, the posts come without them.
     */
    async pagePosts(pageToken: string, pageId: string, since: number) {
      const fetchPosts = (fields: string) =>
        list(postSchema, graph(`/${pageId}/published_posts`, pageToken, { fields, since, limit: 100 }))
      const basic = 'id,created_time,message,permalink_url'
      try {
        return await fetchPosts(
          `${basic},shares,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)`,
        )
      } catch (err) {
        if (err instanceof MetaError && !err.isAuthProblem && !err.isRateLimit) return fetchPosts(basic)
        throw err
      }
    },

    /** Reels published since `since` (Unix seconds). */
    pageReels: (pageToken: string, pageId: string, since: number) =>
      list(
        reelSchema,
        graph(`/${pageId}/video_reels`, pageToken, {
          fields: 'id,created_time,updated_time,description,permalink_url,length',
          since,
          limit: 100,
        }),
      ),

    /** A lifetime number from a post's or video's insights, or null when there is none. */
    async lifetime(token: string, path: string, metric: string): Promise<number | null> {
      const parsed = z.object({ data: z.array(insightSeries) }).parse(
        await graph(path, token, { metric }),
      )
      const value = parsed.data[0]?.values?.[0]?.value
      return typeof value === 'number' ? value : null
    },

    /**
     * Instagram accounts given to the app directly, as Unified Login does: they need no
     * Facebook Page, so they do not show up through `pages`.
     */
    assignedInstagramAccounts: (token: string) =>
      list(
        z.object({ id: z.string(), username: z.string().optional() }),
        graph('/me/assigned_instagram_accounts', token, { fields: 'id,username', limit: 100 }),
      ),

    async instagramAccount(token: string, igId: string) {
      return igAccountSchema.parse(
        await graph(`/${igId}`, token, { fields: 'id,username,followers_count' }),
      )
    },

    /**
     * Views on one Pacific day. `views` only comes as a total over the requested window, so a
     * daily series takes one request per day.
     */
    async instagramViews(token: string, igId: string, day: IsoDate): Promise<number | null> {
      const parsed = z.object({ data: z.array(insightSeries) }).parse(
        await graph(`/${igId}/insights`, token, {
          metric: 'views',
          period: 'day',
          metric_type: 'total_value',
          ...pacificWindow(day, day),
        }),
      )
      return parsed.data[0]?.total_value?.value ?? null
    },

    /** Media newest first, back to `since` (Unix ms). Stories are not included. */
    instagramMedia: (token: string, igId: string, since: number) =>
      list(
        mediaSchema,
        graph(`/${igId}/media`, token, {
          fields:
            'id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count',
          limit: 100,
        }),
        (last) => parseMetaTime(last.timestamp).getTime() < since,
      ).then((items) => items.filter((item) => parseMetaTime(item.timestamp).getTime() >= since)),

    /** A media item's lifetime insights; metrics its type does not support are left out. */
    async mediaInsights(token: string, mediaId: string, productType: string | undefined) {
      const metrics = productType === 'STORY' ? ['views'] : ['views', 'shares', 'saved']
      const parsed = z.object({ data: z.array(insightSeries) }).parse(
        await graph(`/${mediaId}/insights`, token, { metric: metrics.join(',') }),
      )
      const result: Record<string, number> = {}
      for (const series of parsed.data) {
        const value = series.values?.[0]?.value ?? series.total_value?.value
        if (typeof value === 'number') result[series.name] = value
      }
      return result
    },
  }
}

export type MetaClient = ReturnType<typeof createMetaClient>

function chunks(from: IsoDate, to: IsoDate, size: number): { from: IsoDate; to: IsoDate }[] {
  const result: { from: IsoDate; to: IsoDate }[] = []
  let start = from
  while (start <= to) {
    const end = new Date(`${start}T00:00:00Z`)
    end.setUTCDate(end.getUTCDate() + size - 1)
    const chunkEnd = end.toISOString().slice(0, 10)
    result.push({ from: start, to: chunkEnd < to ? chunkEnd : to })
    const next = new Date(`${chunkEnd}T00:00:00Z`)
    next.setUTCDate(next.getUTCDate() + 1)
    start = next.toISOString().slice(0, 10)
  }
  return result
}
