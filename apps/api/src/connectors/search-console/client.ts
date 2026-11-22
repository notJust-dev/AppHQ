import { z } from 'zod'
import type { IsoDate } from '../../lib/dates.js'
import { createTokenSource, type ServiceAccount } from '../google-play/auth.js'

export const SEARCH_CONSOLE = 'search_console'
export const WEBMASTERS_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly'

// Overridable so the connector can run against a local stand-in.
const BASE_URL = process.env.SEARCH_CONSOLE_API_URL ?? 'https://www.googleapis.com/webmasters/v3'

/** Google keeps 16 months of search data. */
export const SEARCH_CONSOLE_HISTORY_DAYS = 480

export class SearchConsoleError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'SearchConsoleError'
  }

  get isAccessProblem(): boolean {
    return this.status === 401 || this.status === 403
  }
}

const sitesResponse = z.object({
  siteEntry: z.array(z.object({ siteUrl: z.string(), permissionLevel: z.string() })).optional(),
})

const queryResponse = z.object({
  rows: z
    .array(
      z.object({
        keys: z.array(z.string()).optional(),
        clicks: z.number(),
        impressions: z.number(),
        ctr: z.number(),
        position: z.number(),
      }),
    )
    .optional(),
})

export type SearchRow = NonNullable<z.infer<typeof queryResponse>['rows']>[number]

/** A property the service account was added to, with data it may read. */
export interface SearchSite {
  siteUrl: string
  permissionLevel: string
}

/**
 * How a property reads to a person: `sc-domain:example.com` is the domain, a URL-prefix
 * property is its host and path.
 */
export function siteName(siteUrl: string): string {
  if (siteUrl.startsWith('sc-domain:')) return siteUrl.slice('sc-domain:'.length)
  try {
    const url = new URL(siteUrl)
    return `${url.host}${url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '')}`
  } catch {
    return siteUrl
  }
}

/** The Search Console API's two calls the dashboard needs: the properties, and search analytics. */
export function createSearchConsoleClient(options: {
  serviceAccount: ServiceAccount
  fetch?: typeof fetch
  baseUrl?: string
}) {
  const doFetch = options.fetch ?? fetch
  const base = (options.baseUrl ?? BASE_URL).replace(/\/$/, '')
  const token = createTokenSource(options.serviceAccount, WEBMASTERS_SCOPE, { fetch: options.fetch })

  async function send(path: string, init: RequestInit = {}): Promise<unknown> {
    const response = await doFetch(`${base}${path}`, {
      ...init,
      headers: { ...init.headers, authorization: `Bearer ${await token()}`, 'content-type': 'application/json' },
      signal: AbortSignal.timeout(60_000),
    })
    const body: unknown = await response.json().catch(() => null)
    if (response.ok) return body
    const message = (body as { error?: { message?: string } } | null)?.error?.message
    throw new SearchConsoleError(response.status, message || `Search Console answered ${response.status}`)
  }

  async function query(siteUrl: string, body: Record<string, unknown>): Promise<SearchRow[]> {
    const parsed = queryResponse.parse(
      await send(`/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    )
    return parsed.rows ?? []
  }

  return {
    /** The properties shared with the service account; unverified ones have no data to read. */
    async listSites(): Promise<SearchSite[]> {
      const parsed = sitesResponse.parse(await send('/sites'))
      return (parsed.siteEntry ?? []).filter((site) => site.permissionLevel !== 'siteUnverifiedUser')
    },

    /** Clicks, impressions and average position per day, for the days Google has data. */
    async daily(siteUrl: string, from: IsoDate, to: IsoDate) {
      const rows = await query(siteUrl, { startDate: from, endDate: to, dimensions: ['date'], rowLimit: 25_000 })
      return rows.flatMap((row) => {
        const date = row.keys?.[0]
        return date ? [{ date, clicks: row.clicks, impressions: row.impressions, position: row.position }] : []
      })
    },

    /** The top search queries or pages over a range, by clicks. */
    async top(siteUrl: string, from: IsoDate, to: IsoDate, dimension: 'query' | 'page', limit: number) {
      const rows = await query(siteUrl, { startDate: from, endDate: to, dimensions: [dimension], rowLimit: limit })
      return rows.map((row) => ({
        key: row.keys?.[0] ?? '',
        clicks: row.clicks,
        impressions: row.impressions,
        position: row.position,
      }))
    },
  }
}

export type SearchConsoleClient = ReturnType<typeof createSearchConsoleClient>
