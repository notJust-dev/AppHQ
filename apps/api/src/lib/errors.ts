import * as Sentry from '@sentry/node'
import type { Breadcrumb, ErrorEvent } from '@sentry/node'

/**
 * Error reporting with Sentry, or anything that speaks its protocol (GlitchTip, a self-hosted
 * Sentry). Off unless SENTRY_DSN is set, so a self-hosted copy never reports to anyone.
 *
 * What is sent is an error's message and stack trace, with the route or sync source it came from.
 * Never request bodies, headers, cookies, query strings, local variables or database query data:
 * those can hold OAuth tokens, API keys and the dashboard's numbers.
 */

let started = false

export interface ErrorReportingConfig {
  dsn: string | undefined
  environment: string
}

/** Starts Sentry when a DSN is set. Returns whether it started. */
export function startErrorReporting(config: ErrorReportingConfig): boolean {
  if (started || !config.dsn) return started
  Sentry.init({
    dsn: config.dsn,
    environment: config.environment,
    // Errors only: no performance tracing.
    tracesSampleRate: 0,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      stackFrameVariables: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      queues: false,
    },
    // Fastify's integration only hooks in when Sentry loads before Fastify (node --import);
    // app.ts reports route errors itself instead, so the integration would only add duplicates.
    integrations: (defaults) => defaults.filter((integration) => integration.name !== 'Fastify'),
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
  })
  started = true
  return true
}

/** Reports an error. Does nothing while error reporting is off. */
export function reportError(error: unknown, tags?: Record<string, string>): void {
  if (!started) return
  Sentry.captureException(error, tags ? { tags } : undefined)
}

/** Waits for queued reports to be sent, for a clean shutdown. */
export async function flushErrorReports(timeoutMs = 2000): Promise<void> {
  if (started) await Sentry.flush(timeoutMs)
}

/** An address without its query string or fragment, where OAuth codes and tokens travel. */
export function withoutQuery(url: string): string {
  const end = url.search(/[?#]/)
  return end === -1 ? url : url.slice(0, end)
}

/**
 * Removes from an event whatever the data collection settings might still let through: the
 * request's body, headers, cookies and query string, and the user.
 */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  if (event.request) {
    const { method, url } = event.request
    event.request = { method, url: url ? withoutQuery(url) : undefined }
  }
  delete event.user
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb).filter((crumb): crumb is Breadcrumb => crumb !== null)
  }
  return event
}

/**
 * Keeps a breadcrumb's method, status and address, without the query string. Console breadcrumbs
 * are dropped: log lines can name accounts and apps.
 */
export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  if (breadcrumb.category === 'console') return null
  const data = breadcrumb.data
  if (!data) return breadcrumb
  const kept: Record<string, unknown> = {}
  for (const key of ['method', 'http.method', 'http.request.method', 'status_code']) if (key in data) kept[key] = data[key]
  if (typeof data.url === 'string') kept.url = withoutQuery(data.url)
  return { ...breadcrumb, data: kept }
}
