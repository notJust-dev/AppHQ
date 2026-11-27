import * as Sentry from '@sentry/react'
import type { Breadcrumb, Event } from '@sentry/react'
import { privacyOn } from './privacy'

/**
 * Error reporting from the browser with Sentry, or anything that speaks its protocol (GlitchTip,
 * a self-hosted Sentry). Off unless the server has SENTRY_DSN set.
 *
 * What is sent is an error's message and stack trace and the page's address, without its query
 * string or fragment (the password reset link carries its token after the `#`). Never cookies,
 * headers, request bodies, console output, session replays or the user.
 *
 * The same DSN turns on the feedback form (see lib/feedback.ts); feedback is scrubbed the same way.
 */

let started = false
const listeners = new Set<() => void>()
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
    // The feedback form, opened from the sidebar (see lib/feedback.ts), never a floating button.
    integrations: [
      Sentry.feedbackIntegration({
        autoInject: false,
        showBranding: false,
        showName: false,
        // The form's colours come from the stylesheet (#sentry-feedback in styles.css).
        colorScheme: 'system',
        formTitle: 'Send feedback',
        messageLabel: 'Feedback',
        messagePlaceholder: 'What works, what doesn’t, what’s missing?',
        emailLabel: 'Email',
        emailPlaceholder: 'Optional, for a reply',
        submitButtonLabel: 'Send feedback',
        successMessageText: 'Thanks, your feedback was sent',
      }),
    ],
  })
  // Feedback is not an error event, so it skips beforeSend. An event processor sees every event
  // once its breadcrumbs are on it.
  Sentry.addEventProcessor((event) => (event.type === 'feedback' ? scrubFeedback(event) : event))
  for (const error of early) Sentry.captureException(error)
  early = []
  for (const listener of listeners) listener()
}

/** Whether error reporting, and with it the feedback form, is on in this page. */
export function errorReportingStarted(): boolean {
  return started
}

/** Calls `listener` when error reporting starts. Returns a function that stops it. */
export function onErrorReportingStart(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
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

export function scrubEvent<T extends Event>(event: T): T {
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

/** The signed-in account's email, sent with feedback in place of asking for it. */
let feedbackEmail: string | null = null

/**
 * Sets the email feedback is sent with; null asks for one in the form. Kept out of Sentry's user,
 * which would also go out with every session ping.
 */
export function setFeedbackEmail(email: string | null) {
  feedbackEmail = email
}

/**
 * Feedback gets the same scrubbing as errors, and the form's own copy of the page address loses
 * its query and fragment too. It carries the signed-in account's email when there is one. With
 * privacy mode on it carries no breadcrumbs, since a clicked element's selector can hold a label
 * that names an app or account.
 */
export function scrubFeedback<T extends Event>(event: T, privacy = privacyOn(), email = feedbackEmail): T {
  scrubEvent(event)
  const feedback = event.contexts?.feedback
  if (feedback && typeof feedback.url === 'string') feedback.url = withoutQuery(feedback.url)
  if (feedback && email && !feedback.contact_email) feedback.contact_email = email
  if (privacy) {
    delete event.breadcrumbs
    event.tags = { ...event.tags, privacy_mode: 'on' }
  }
  return event
}
