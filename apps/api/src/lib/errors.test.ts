import type { ErrorEvent } from '@sentry/node'
import { describe, expect, it } from 'vitest'
import { reportError, scrubBreadcrumb, scrubEvent, withoutQuery } from './errors.js'

describe('withoutQuery', () => {
  it('drops the query string and the fragment', () => {
    expect(withoutQuery('https://api.example.com/oauth?code=test-code&state=x')).toBe('https://api.example.com/oauth')
    expect(withoutQuery('https://example.com/reset#token=test-token')).toBe('https://example.com/reset')
    expect(withoutQuery('/trpc/apps.list')).toBe('/trpc/apps.list')
  })
})

describe('scrubEvent', () => {
  it('keeps only the method and the address without its query', () => {
    const event = {
      type: undefined,
      request: {
        method: 'POST',
        url: 'https://api.example.com/trpc/sync?token=test-token',
        headers: { authorization: 'Bearer test-token-that-is-at-least-32-characters' },
        cookies: { session: 'test-session' },
        data: { apiKey: 'test-api-key' },
        query_string: 'token=test-token',
      },
      user: { email: 'someone@example.com' },
    } as ErrorEvent
    const scrubbed = scrubEvent(event)
    expect(scrubbed.request).toEqual({ method: 'POST', url: 'https://api.example.com/trpc/sync' })
    expect(scrubbed.user).toBeUndefined()
  })

  it('scrubs breadcrumbs too', () => {
    const event = {
      type: undefined,
      breadcrumbs: [
        { category: 'console', message: 'synced Example App' },
        { category: 'http', data: { method: 'GET', url: 'https://graph.example.com/me?access_token=test-token', status_code: 200 } },
      ],
    } as ErrorEvent
    expect(scrubEvent(event).breadcrumbs).toEqual([
      { category: 'http', data: { method: 'GET', url: 'https://graph.example.com/me', status_code: 200 } },
    ])
  })
})

describe('scrubBreadcrumb', () => {
  it('drops console breadcrumbs', () => {
    expect(scrubBreadcrumb({ category: 'console', message: 'hello' })).toBeNull()
  })

  it('drops request and response bodies from http breadcrumbs', () => {
    expect(
      scrubBreadcrumb({ category: 'http', data: { method: 'POST', url: 'https://example.com/token', body: 'client_secret=test-secret' } }),
    ).toEqual({ category: 'http', data: { method: 'POST', url: 'https://example.com/token' } })
  })
})

describe('reportError', () => {
  it('does nothing while error reporting is off', () => {
    expect(() => reportError(new Error('test error'))).not.toThrow()
  })
})
