import '@tanstack/react-start/server-only'

/**
 * Product analytics are off unless POSTHOG_KEY is set, so a self-hosted copy never reports to
 * anyone. Events go to this server's own `/ingest` route, which forwards them to PostHog.
 */
export type AnalyticsConfig = { key: string; uiHost: string } | null

const DEFAULT_HOST = 'https://us.i.posthog.com'

/** PostHog's cloud hosts, by region: where events go, where scripts come from, and the app. */
const CLOUD = /^https:\/\/(eu|us)\.i\.posthog\.com$/

/** The ingestion host events are forwarded to: POSTHOG_HOST, or PostHog's US cloud. */
export function posthogHost(): string {
  const configured = process.env.POSTHOG_HOST?.trim()
  return configured ? new URL(configured).origin : DEFAULT_HOST
}

/** Where PostHog's cloud serves its scripts; a self-hosted PostHog serves them itself. */
export function posthogAssetsHost(): string {
  const host = posthogHost()
  const region = CLOUD.exec(host)?.[1]
  return region ? `https://${region}-assets.i.posthog.com` : host
}

export function analyticsConfig(): AnalyticsConfig {
  const key = process.env.POSTHOG_KEY?.trim()
  if (!key) return null
  const host = posthogHost()
  const region = CLOUD.exec(host)?.[1]
  return { key, uiHost: region ? `https://${region}.posthog.com` : host }
}
