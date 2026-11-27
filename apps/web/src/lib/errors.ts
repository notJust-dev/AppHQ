import * as Sentry from '@sentry/react'
import type { Breadcrumb, ErrorEvent } from '@sentry/react'

/**
 * Error reporting from the browser with Sentry, or anything that speaks its protocol (GlitchTip,
 * a self-hosted Sentry). Off unless the server has SENTRY_DSN set.
 *
 * What is sent is an error's message and stack trace and the page's address, without its query
 * string or fragment (the password reset link carries its token after the `#`). Never cookies,
 * headers, request bodies, console output, session replays or the user.
 */

let started = false
/** Errors reported before Sentry started (child effects run before the root's), sent once it does. */
let early: unknown[] = []

export function startErrorReporting(config: { dsn: string; environment: string }) {
  if (started || typeof window === 'undefined') return
  started = true
  Sentry.init({
    dsn: config.dsn,
    environment: config.environment,
    // Errors only: no performance tracing and no session replays.
    tracesSampleRate: 0,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      stackFrameVariables: false,
    },
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
  })
  for (const error of early) Sentry.captureException(error)
  early = []
}

/** Reports an error. Does nothing while error reporting is off. */
export function reportError(error: unknown) {
  if (started) Sentry.captureException(error)
  else if (typeof window !== 'undefined' && early.length < 10) early.push(error)
}

/** An address without its query string or fragment. */
export function withoutQuery(url: string): string {
  const end = url.search(/[?#]/)
  return end === -1 ? url : url.slice(0, end)
}

export function scrubEvent(event: ErrorEvent): ErrorEvent {
  if (event.request) {
    const url = event.request.url
    event.request = { url: url ? withoutQuery(url) : undefined }
  }
  delete event.user
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb).filter((crumb): crumb is Breadcrumb => crumb !== null)
  }
  return event
}

/**
 * Drops console breadcrumbs, and keeps only the method, status and addresses (without query
 * strings) of the rest. Click breadcrumbs keep the element's selector, never its text.
 */
export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  if (breadcrumb.category === 'console') return null
  const data = breadcrumb.data
  if (!data) return breadcrumb
  const kept: Record<string, unknown> = {}
  for (const key of ['method', 'http.method', 'http.request.method', 'status_code']) if (key in data) kept[key] = data[key]
  for (const key of ['url', 'from', 'to']) if (typeof data[key] === 'string') kept[key] = withoutQuery(data[key])
  return { ...breadcrumb, data: kept }
}
