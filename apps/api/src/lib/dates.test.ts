import { describe, expect, it } from 'vitest'
import { addDays, eachDay, previousPeriod, rangeLength, trailingRange } from './dates.js'

describe('dates', () => {
  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('counts both ends of a range', () => {
    expect(rangeLength({ from: '2026-11-01', to: '2026-11-01' })).toBe(1)
    expect(rangeLength({ from: '2026-11-01', to: '2026-11-28' })).toBe(28)
    expect(eachDay({ from: '2026-11-29', to: '2026-12-01' })).toEqual([
      '2026-11-29',
      '2026-11-30',
      '2026-12-01',
    ])
  })

  it('gives the adjacent period of equal length', () => {
    expect(previousPeriod({ from: '2026-11-08', to: '2026-11-14' })).toEqual({
      from: '2026-11-01',
      to: '2026-11-07',
    })
  })

  it('builds a trailing window that ends today in UTC', () => {
    const now = new Date('2026-11-20T23:30:00Z')
    expect(trailingRange(7, now)).toEqual({ from: '2026-11-14', to: '2026-11-20' })
  })
})
