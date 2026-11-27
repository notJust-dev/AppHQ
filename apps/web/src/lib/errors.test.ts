import type { ErrorEvent } from '@sentry/react'
import { describe, expect, it } from 'vitest'
import { scrubBreadcrumb, scrubEvent, withoutQuery } from './errors'

describe('withoutQuery', () => {
  it('drops the query string and the fragment', () => {
    expect(withoutQuery('https://apphq.example.com/reset-password#token=test-token')).toBe('https://apphq.example.com/reset-password')
    expect(withoutQuery('https://apphq.example.com/connect/tiktok/callback?code=test-code')).toBe('https://apphq.example.com/connect/tiktok/callback')
  })
})

describe('scrubEvent', () => {
  it('keeps only the address, without its query or fragment', () => {
    const event = {
      type: undefined,
      request: {
        url: 'https://apphq.example.com/reset-password#token=test-token',
        headers: { 'User-Agent': 'test' },
        cookies: { session: 'test-session' },
      },
      user: { ip_address: '{{auto}}' },
    } as ErrorEvent
    const scrubbed = scrubEvent(event)
    expect(scrubbed.request).toEqual({ url: 'https://apphq.example.com/reset-password' })
    expect(scrubbed.user).toBeUndefined()
  })
})

describe('scrubBreadcrumb', () => {
  it('drops console breadcrumbs', () => {
    expect(scrubBreadcrumb({ category: 'console', message: 'Example App: $1,234' })).toBeNull()
  })

  it('strips queries and fragments from navigation breadcrumbs', () => {
    expect(
      scrubBreadcrumb({ category: 'navigation', data: { from: '/reset-password#token=test-token', to: '/login?next=/apps' } }),
    ).toEqual({ category: 'navigation', data: { from: '/reset-password', to: '/login' } })
  })

  it('keeps the method, status and address of fetch breadcrumbs, nothing else', () => {
    expect(
      scrubBreadcrumb({ category: 'fetch', data: { method: 'POST', url: '/_serverFn/x?payload=secret', status_code: 500, request_body_size: 10 } }),
    ).toEqual({ category: 'fetch', data: { method: 'POST', url: '/_serverFn/x', status_code: 500 } })
  })
})
