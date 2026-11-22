import { gunzipSync } from 'node:zlib'
import { z } from 'zod'
import type { IsoDate } from '../../lib/dates.js'
import { createAppStoreToken, type AppStoreCredentials } from './token.js'

/**
 * Minimal client for the App Store Connect API: the app list, the daily sales report, and the
 * analytics reports (requests, the Discovery and Engagement report, its instances and files).
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
      attributes: z
        .object({ accessType: z.string().nullish(), stoppedDueToInactivity: z.boolean().nullish() })
        .nullish(),
    }),
  ),
  links: z.object({ next: z.string().nullish() }).nullish(),
})

const reportsPage = z.object({
  data: z.array(
    z.object({ id: z.string(), attributes: z.object({ name: z.string(), category: z.string().nullish() }) }),
  ),
  links: z.object({ next: z.string().nullish() }).nullish(),
})

const instancesPage = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      attributes: z.object({ granularity: z.string().nullish(), processingDate: z.string() }),
    }),
  ),
  links: z.object({ next: z.string().nullish() }).nullish(),
})

const segmentsPage = z.object({
  data: z.array(z.object({ attributes: z.object({ url: z.string() }) })),
  links: z.object({ next: z.string().nullish() }).nullish(),
})

/** The report with daily impressions and product page views. Its Detailed twin adds noise. */
export const ENGAGEMENT_REPORT = 'App Store Discovery and Engagement Standard'

export type ReportAccess = 'ONGOING' | 'ONE_TIME_SNAPSHOT'

export interface ReportRequest {
  id: string
  accessType: ReportAccess | string
  /** Apple stops an ongoing request whose reports nobody downloads for a long time. */
  stopped: boolean
}

/** One generation of a report. A daily instance holds the few days before its processing date. */
export interface ReportInstance {
  id: string
  processingDate: IsoDate
}

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

    /** The app's analytics report requests, ongoing and one-time snapshots alike. */
    async listReportRequests(appleId: string): Promise<ReportRequest[]> {
      const requests: ReportRequest[] = []
      let next: string | null | undefined = `/v1/apps/${encodeURIComponent(appleId)}/analyticsReportRequests?limit=200`
      for (let page = 0; next && page < MAX_PAGES; page++) {
        const parsed = reportRequestsPage.parse(await getJson(next))
        for (const request of parsed.data) {
          requests.push({
            id: request.id,
            accessType: request.attributes?.accessType ?? 'ONGOING',
            stopped: request.attributes?.stoppedDueToInactivity === true,
          })
        }
        next = parsed.links?.next
      }
      return requests
    },

    /**
     * Asks Apple to generate analytics reports for an app: ONGOING for every day from now on,
     * ONE_TIME_SNAPSHOT for the history (from January 2024). Only an Admin key may ask; reports
     * arrive a day or two later.
     */
    async createReportRequest(appleId: string, accessType: ReportAccess): Promise<void> {
      const response = await send('/v1/analyticsReportRequests', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          data: {
            type: 'analyticsReportRequests',
            attributes: { accessType },
            relationships: { app: { data: { type: 'apps', id: appleId } } },
          },
        }),
      })
      // 409 means a request already exists, which is the state we wanted.
      if (!response.ok && response.status !== 409) await fail(response)
    },

    /** The Discovery and Engagement report of a request, or null before Apple has made it. */
    async findEngagementReport(requestId: string): Promise<string | null> {
      let next: string | null | undefined =
        `/v1/analyticsReportRequests/${encodeURIComponent(requestId)}/reports?filter[category]=APP_STORE_ENGAGEMENT&limit=200`
      for (let page = 0; next && page < MAX_PAGES; page++) {
        const parsed = reportsPage.parse(await getJson(next))
        const report = parsed.data.find((entry) => entry.attributes.name === ENGAGEMENT_REPORT)
        if (report) return report.id
        next = parsed.links?.next
      }
      return null
    },

    /** The report's daily instances, in no particular order. */
    async listDailyInstances(reportId: string): Promise<ReportInstance[]> {
      const instances: ReportInstance[] = []
      let next: string | null | undefined =
        `/v1/analyticsReports/${encodeURIComponent(reportId)}/instances?filter[granularity]=DAILY&limit=200`
      // A year of daily instances is two pages; history snapshots can add a few more.
      for (let page = 0; next && page < MAX_PAGES * 2; page++) {
        const parsed = instancesPage.parse(await getJson(next))
        for (const instance of parsed.data) {
          instances.push({ id: instance.id, processingDate: instance.attributes.processingDate })
        }
        next = parsed.links?.next
      }
      return instances
    },

    /** The files of one instance, unzipped: tab-separated text with a header row. */
    async downloadInstance(instanceId: string): Promise<string[]> {
      const urls: string[] = []
      let next: string | null | undefined =
        `/v1/analyticsReportInstances/${encodeURIComponent(instanceId)}/segments?limit=200`
      for (let page = 0; next && page < MAX_PAGES; page++) {
        const parsed = segmentsPage.parse(await getJson(next))
        urls.push(...parsed.data.map((segment) => segment.attributes.url))
        next = parsed.links?.next
      }
      const files: string[] = []
      for (const url of urls) {
        // A signed link to Apple's storage: it carries its own authorization.
        const response = await doFetch(url, { signal: AbortSignal.timeout(120_000) })
        if (!response.ok) throw new AppStoreError(response.status, undefined, `A report file answered ${response.status}`)
        const bytes = Buffer.from(await response.arrayBuffer())
        const isGzip = bytes[0] === 0x1f && bytes[1] === 0x8b
        files.push((isGzip ? gunzipSync(bytes) : bytes).toString('utf8'))
      }
      return files
    },
  }
}

export type AppStoreClient = ReturnType<typeof createAppStoreClient>
