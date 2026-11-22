import { describe, expect, it } from 'vitest'
import { lastCompleteDay } from './complete.js'

describe('lastCompleteDay', () => {
  it('waits for the slowest source still reporting', () => {
    expect(
      lastCompleteDay(new Map([['app_store', '2026-11-21'], ['google_play', '2026-11-17'], ['revenuecat', '2026-11-22']])),
    ).toEqual({ through: '2026-11-17', waitingFor: ['app_store', 'google_play'] })
  })

  it('does not wait for a source that stopped long ago', () => {
    expect(lastCompleteDay(new Map([['app_store', '2026-11-21'], ['google_play', '2026-09-30']]))).toEqual({
      through: '2026-11-21',
      waitingFor: [],
    })
  })

  it('has nothing to say without sources', () => {
    expect(lastCompleteDay(new Map())).toEqual({ through: null, waitingFor: [] })
  })
})
