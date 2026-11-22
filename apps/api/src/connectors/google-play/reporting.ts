import { z } from 'zod'

/**
 * The Play Developer Reporting API, used only for one thing: the titles of the account's apps.
 * It has no installs data (that is in the report files), and it needs the API enabled in the
 * service account's Google Cloud project, so callers treat a failure as "no titles".
 */

export const REPORTING_SCOPE = 'https://www.googleapis.com/auth/playdeveloperreporting'

const searchSchema = z.object({
  apps: z.array(z.object({ packageName: z.string(), displayName: z.string().optional() })).optional(),
  nextPageToken: z.string().optional(),
})

export async function appTitles(options: {
  token: () => Promise<string>
  fetch?: typeof fetch
  baseUrl?: string
}): Promise<Map<string, string>> {
  const doFetch = options.fetch ?? fetch
  const base = (
    options.baseUrl ??
    process.env.GOOGLE_PLAY_REPORTING_URL ??
    'https://playdeveloperreporting.googleapis.com'
  ).replace(/\/$/, '')
  const titles = new Map<string, string>()
  let pageToken: string | undefined
  for (let page = 0; page < 10; page++) {
    const url = new URL(`${base}/v1beta1/apps:search`)
    url.searchParams.set('pageSize', '1000')
    if (pageToken) url.searchParams.set('pageToken', pageToken)
    const response = await doFetch(url, {
      headers: { authorization: `Bearer ${await options.token()}` },
      signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok) throw new Error(`Play Developer Reporting API answered ${response.status}`)
    const parsed = searchSchema.parse(await response.json())
    for (const app of parsed.apps ?? []) {
      if (app.displayName) titles.set(app.packageName, app.displayName)
    }
    pageToken = parsed.nextPageToken
    if (!pageToken) break
  }
  return titles
}
