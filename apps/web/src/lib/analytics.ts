import posthog from 'posthog-js'

let started = false

/**
 * Removes what follows the `#` from every address in an event. The password reset link carries
 * its token there; the page takes it out of the address bar before analytics start (see
 * routes/reset-password.tsx), and this makes sure of it for every event, whatever ran first.
 */
export function withoutFragments(properties: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(properties)) {
    if (typeof value === 'string' && /url|referrer|href/i.test(key) && value.includes('#')) {
      properties[key] = value.slice(0, value.indexOf('#'))
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      withoutFragments(value as Record<string, unknown>)
    }
  }
}
/** Set before PostHog starts (child effects run before the root's), applied once it does. */
let signedInBeforeStart: boolean | undefined

/**
 * Starts PostHog in the browser, once. Set up so it needs no consent banner and never sees the
 * dashboard's numbers:
 * - cookieless: nothing is stored in the browser, so each visit counts as new;
 * - autocapture keeps the fact of a click but masks every element's text and attributes, so
 *   revenue, app names and reviews in the dashboard never leave the page;
 * - no session recordings or surveys;
 * - addresses are sent without what follows the `#`.
 */
export function startAnalytics(config: { key: string; uiHost: string }) {
  if (started || typeof window === 'undefined') return
  started = true
  posthog.init(config.key, {
    api_host: '/ingest',
    ui_host: config.uiHost,
    cookieless_mode: 'always',
    person_profiles: 'identified_only',
    capture_pageview: 'history_change',
    capture_pageleave: true,
    autocapture: true,
    mask_all_text: true,
    mask_all_element_attributes: true,
    disable_session_recording: true,
    disable_surveys: true,
    before_send: (event) => {
      if (event) {
        withoutFragments(event.properties)
        if (event.$set) withoutFragments(event.$set)
        if (event.$set_once) withoutFragments(event.$set_once)
      }
      return event
    },
  })
  if (signedInBeforeStart !== undefined) posthog.register({ signed_in: signedInBeforeStart })
}

/** Records a named event. Does nothing while analytics are off. Never pass an email address. */
export function track(event: string, properties?: Record<string, string | number | boolean>) {
  if (started) posthog.capture(event, properties)
}

/**
 * Tags every following event with whether the visitor is signed in. Today the only person who
 * can sign in is the owner, so this keeps their own dashboard use out of the landing numbers.
 */
export function setSignedIn(signedIn: boolean) {
  if (started) posthog.register({ signed_in: signedIn })
  else signedInBeforeStart = signedIn
}
