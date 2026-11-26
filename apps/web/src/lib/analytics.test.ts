import { describe, expect, it } from 'vitest'
import { withoutFragments } from './analytics'

describe('withoutFragments', () => {
  it('removes what follows the # from every address in an event, nested ones too', () => {
    const properties: Record<string, unknown> = {
      $current_url: 'https://apphq.example.com/reset-password#token=test-token',
      $referrer: 'https://apphq.example.com/login#x',
      $pathname: '/reset-password',
      $session_entry_url: 'https://apphq.example.com/reset-password?a=1#token=test-token',
      nested: { $initial_current_url: 'https://apphq.example.com/#token=test-token' },
      title: 'Issue #12',
      count: 3,
    }
    withoutFragments(properties)
    expect(JSON.stringify(properties)).not.toContain('test-token')
    expect(properties).toEqual({
      $current_url: 'https://apphq.example.com/reset-password',
      $referrer: 'https://apphq.example.com/login',
      $pathname: '/reset-password',
      $session_entry_url: 'https://apphq.example.com/reset-password?a=1',
      nested: { $initial_current_url: 'https://apphq.example.com/' },
      // Not an address: left alone.
      title: 'Issue #12',
      count: 3,
    })
  })
})
