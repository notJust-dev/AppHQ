import { gunzipSync } from 'node:zlib'
import { z } from 'zod'
import type { IsoDate } from '../../lib/dates.js'
import { createAppStoreToken, type AppStoreCredentials } from './token.js'

/**
 * Minimal client for the App Store Connect API: the app list, the daily sales report, and the
 * analytics report requests.
 */

// Overridable so the whole flow can be exercised against a local stand-in, without a real key.
const BASE_URL = process.env.APP_STORE_CONNECT_API_URL ?? 'https://api.appstoreconnect.apple.com'
const TOKEN_REFRESH_MS = 10 * 60 * 1000
const MAX_PAGES = 20

export class AppStoreError extends Error {
  constructor(
    readonly status: number,
    /** Apple's error code, e.g. `NOT_AUTHORIZED`. */
    readonly code: string | undefined,
    message: string,
  ) {
    super(message)
    this.name = 'AppStoreError'
  }

  /** The key was rejected or lacks the role, as opposed to a bad request or an outage. */
  get isAuthProblem(): boolean {
    return this.status === 401 || this.status === 403
  }
}

const errorBody = z.object({
  errors: z.array(
    z.object({
      code: z.string().optional(),
      title: z.string().optional(),
      detail: z.string().optional(),
    }),
  ),
})

const appsPage = z.object({
  data: z.array(
    z.object({
      // The resource id is the app's Apple ID, the same number sales reports call
      // "Apple Identifier".
      id: z.string(),
      attributes: z.object({ name: z.string(), bundleId: z.string() }),
    }),
  ),
  links: z.object({ next: z.string().nullish() }).nullish(),
})

const reportRequestsPage = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      attributes: z.object({ stoppedDueToInactivity: z.boolean().nullish() }).nullish(),
    }),
  ),
})

export interface AppStoreApp {
  appleId: string
  name: string
  bundleId: string
}

export function createAppStoreClient(options: {
  credentials: AppStoreCredentials
  fetch?: typeof fetch
}) {
  const doFetch = options.fetch ?? fetch
  let token: { value: string; madeAt: number } | undefined

  const authorization = () => {
    if (!token || Date.now() - token.madeAt > TOKEN_REFRESH_MS) {
      token = { value: createAppStoreToken(options.credentials), madeAt: Date.now() }
    }
    return `Bearer ${token.value}`
  }

  async function send(pathOrUrl: string, init: RequestInit = {}): Promise<Response> {
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : BASE_URL + pathOrUrl
    const response = await doFetch(url, {
      ...init,
      headers: { ...init.headers, authorization: authorization() },
      signal: AbortSignal.timeout(60_000),
    })
    return response
  }

  async function fail(response: Response): Promise<never> {
    const parsed = errorBody.safeParse(await response.json().catch(() => null))
    const first = parsed.data?.errors[0]
    throw new AppStoreError(
      response.status,
      first?.code,
      first?.detail ?? first?.title ?? `App Store Connect answered ${response.status}`,
    )
  }

  async function getJson(pathOrUrl: string): Promise<unknown> {
    const response = await send(pathOrUrl, { headers: { accept: 'application/json' } })
    return response.ok ? response.json() : fail(response)
  }

  return {
    /** Every app in the account. */
    async listApps(): Promise<AppStoreApp[]> {
      const apps: AppStoreApp[] = []
      let next: string | null | undefined = '/v1/apps?fields[apps]=bundleId,name&limit=200'
      for (let page = 0; next && page < MAX_PAGES; page++) {
        const parsed = appsPage.parse(await getJson(next))
        for (const app of parsed.data) {
          apps.push({ appleId: app.id, name: app.attributes.name, bundleId: app.attributes.bundleId })
        }
        next = parsed.links?.next
      }
      return apps
    },

    /**
     * The Summary Sales Report for one day as tab-separated text, or null when Apple has no
     * report for that day (not generated yet, or nothing sold or downloaded).
     */
    async getDailySalesReport(date: IsoDate): Promise<string | null> {
      const query = new URLSearchParams({
        'filter[frequency]': 'DAILY',
        'filter[reportType]': 'SALES',
        'filter[reportSubType]': 'SUMMARY',
        'filter[vendorNumber]': options.credentials.vendorNumber,
        'filter[reportDate]': date,
        'filter[version]': '1_0',
      })
      const response = await send(`/v1/salesReports?${query}`, {
        headers: { accept: 'application/a-gzip, application/json' },
      })
      if (response.status === 404) return null
      if (!response.ok) return fail(response)

      const bytes = Buffer.from(await response.arrayBuffer())
      const isGzip = bytes[0] === 0x1f && bytes[1] === 0x8b
      return (isGzip ? gunzipSync(bytes) : bytes).toString('utf8')
    },

    /** True when the app already has a live ongoing analytics report request. */
    async hasOngoingReportRequest(appleId: string): Promise<boolean> {
      const body = await getJson(
        `/v1/apps/${encodeURIComponent(appleId)}/analyticsReportRequests?filter[accessType]=ONGOING`,
      )
      return reportRequestsPage
        .parse(body)
        .data.some((request) => request.attributes?.stoppedDueToInactivity !== true)
    },

    /**
     * Asks Apple to start generating analytics reports (impressions, page views) for an app.
     * Needs an Admin key. The first reports arrive one to two days later.
     */
    async createOngoingReportRequest(appleId: string): Promise<void> {
      const response = await send('/v1/analyticsReportRequests', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          data: {
            type: 'analyticsReportRequests',
            attributes: { accessType: 'ONGOING' },
            relationships: { app: { data: { type: 'apps', id: appleId } } },
          },
        }),
      })
      // 409 means a request already exists, which is the state we wanted.
      if (!response.ok && response.status !== 409) await fail(response)
    },
  }
}

export type AppStoreClient = ReturnType<typeof createAppStoreClient>
