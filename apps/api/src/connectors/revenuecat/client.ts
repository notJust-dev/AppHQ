import { z } from 'zod'
import type { DateRange } from '../../lib/dates.js'

/**
 * Minimal client for the RevenueCat REST API v2: just what the connector needs.
 * Auth is a v2 secret key with read permission for charts (and, to discover the project and its
 * store apps when connecting, for project configuration).
 */

// Overridable so the whole flow can be exercised against a local stand-in, without a real key.
const BASE_URL = process.env.REVENUECAT_API_URL ?? 'https://api.revenuecat.com/v2'
const MAX_ATTEMPTS = 4
const MAX_PAGES = 20

export class RevenueCatError extends Error {
  constructor(
    readonly status: number,
    /** RevenueCat's error type, e.g. `authentication_error`. */
    readonly type: string | undefined,
    message: string,
  ) {
    super(message)
    this.name = 'RevenueCatError'
  }

  /** The key itself was rejected, as opposed to a bad request or an outage. */
  get isAuthProblem(): boolean {
    return this.status === 401 || this.status === 403
  }
}

const errorBody = z.object({
  type: z.string().optional(),
  message: z.string().optional(),
  backoff_ms: z.number().optional(),
})

const listOf = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), next_page: z.string().nullish() })

const projectSchema = z.object({ id: z.string(), name: z.string() })

const appSchema = z.object({
  id: z.string(),
  name: z.string().nullish(),
  type: z.string(),
  app_store: z.object({ bundle_id: z.string().nullish() }).nullish(),
  play_store: z.object({ package_name: z.string().nullish() }).nullish(),
})

/**
 * A chart response. `values` is a flat list of points; `measure` indexes into `measures`, and
 * `cohort` is the start of the period as Unix seconds. Unknown fields are ignored.
 */
export const chartSchema = z.object({
  measures: z.array(z.object({ display_name: z.string() })).nullish(),
  values: z.array(
    z.object({
      cohort: z.number(),
      measure: z.number().int().optional(),
      segment: z.number().int().optional(),
      value: z.number().nullable(),
      incomplete: z.boolean().optional(),
    }),
  ),
})

export type RevenueCatProject = z.infer<typeof projectSchema>
export type RevenueCatApp = z.infer<typeof appSchema>
export type RevenueCatChart = z.infer<typeof chartSchema>

export interface RevenueCatClientOptions {
  apiKey: string
  fetch?: typeof fetch
  /** Replaced in tests so rate-limit retries do not actually wait. */
  sleep?: (ms: number) => Promise<void>
}

export function createRevenueCatClient(options: RevenueCatClientOptions) {
  const doFetch = options.fetch ?? fetch
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)))

  async function request(pathOrUrl: string, query: Record<string, string> = {}): Promise<unknown> {
    const url = new URL(pathOrUrl.startsWith('http') ? pathOrUrl : BASE_URL + pathOrUrl)
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)

    for (let attempt = 1; ; attempt++) {
      const response = await doFetch(url, {
        headers: { authorization: `Bearer ${options.apiKey}`, accept: 'application/json' },
        signal: AbortSignal.timeout(30_000),
      })
      const body: unknown = await response.json().catch(() => null)
      if (response.ok) return body

      const error = errorBody.safeParse(body).data
      if (response.status === 429 && attempt < MAX_ATTEMPTS) {
        const headerSeconds = Number(response.headers.get('retry-after'))
        const waitMs = error?.backoff_ms ?? (headerSeconds > 0 ? headerSeconds * 1000 : 5000)
        await sleep(Math.min(waitMs, 60_000))
        continue
      }
      throw new RevenueCatError(
        response.status,
        error?.type,
        error?.message ?? `RevenueCat answered ${response.status}`,
      )
    }
  }

  async function listAll<T extends z.ZodType>(path: string, item: T): Promise<z.infer<T>[]> {
    const schema = listOf(item)
    const items: z.infer<T>[] = []
    let next: string | null | undefined = path
    for (let page = 0; next && page < MAX_PAGES; page++) {
      // `next_page` is a path that already starts with /v2.
      const target: string = next.startsWith('/v2/') ? next.slice('/v2'.length) : next
      const parsed = schema.parse(await request(target, page === 0 ? { limit: '100' } : {}))
      items.push(...parsed.items)
      next = parsed.next_page
    }
    return items
  }

  return {
    listProjects: () => listAll('/projects', projectSchema),

    listApps: (projectId: string) =>
      listAll(`/projects/${encodeURIComponent(projectId)}/apps`, appSchema),

    /** One chart, one point per day, in USD. */
    async getDailyChart(projectId: string, chart: string, range: DateRange) {
      const body = await request(
        `/projects/${encodeURIComponent(projectId)}/charts/${encodeURIComponent(chart)}`,
        {
          realtime: 'true',
          // Resolution ids come from the chart's /options endpoint; "0" is daily on every chart.
          resolution: '0',
          start_date: range.from,
          end_date: range.to,
          currency: 'USD',
        },
      )
      return chartSchema.parse(body)
    },
  }
}

export type RevenueCatClient = ReturnType<typeof createRevenueCatClient>
