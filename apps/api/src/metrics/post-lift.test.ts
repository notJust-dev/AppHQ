import { describe, expect, it } from 'vitest'
import { addDays, eachDay } from '../lib/dates.js'
import { downloadLift } from './post-lift.js'

/** A steady 10 a day from Nov 1 to Nov 20, with the given days replaced. */
function downloads(overrides: Record<string, number> = {}) {
  const map = new Map<string, number>()
  for (const day of eachDay({ from: '2026-11-01', to: '2026-11-20' })) map.set(day, 10)
  for (const [day, value] of Object.entries(overrides)) map.set(day, value)
  return map
}

describe('downloadLift', () => {
  it('compares the post day and the two after with the week before', () => {
    const lift = downloadLift(
      downloads({ '2026-11-10': 40, '2026-11-11': 25, '2026-11-12': 15 }),
      '2026-11-10',
      '2026-11-20',
    )
    expect(lift).toEqual({ status: 'ok', downloads: 80, expected: 30, change: 50, changeRatio: 1.667 })
  })

  it('reports a drop as a negative change', () => {
    const lift = downloadLift(
      downloads({ '2026-11-10': 5, '2026-11-11': 5, '2026-11-12': 5 }),
      '2026-11-10',
      '2026-11-20',
    )
    expect(lift).toMatchObject({ status: 'ok', change: -15, changeRatio: -0.5 })
  })

  it('waits until all three days are reported', () => {
    expect(downloadLift(downloads(), '2026-11-19', '2026-11-20')).toEqual({ status: 'too_recent' })
    expect(downloadLift(downloads(), '2026-11-18', '2026-11-20').status).toBe('ok')
  })

  it('needs at least four days of baseline', () => {
    // Data starts Nov 1, so a post on Nov 4 has only three days before it.
    expect(downloadLift(downloads(), '2026-11-04', '2026-11-20')).toEqual({ status: 'no_baseline' })
    expect(downloadLift(downloads(), '2026-11-05', '2026-11-20').status).toBe('ok')
  })

  it('has nothing to say without downloads', () => {
    expect(downloadLift(new Map(), '2026-11-10', null)).toEqual({ status: 'no_downloads' })
    const gap = downloads()
    gap.delete(addDays('2026-11-10', 1))
    expect(downloadLift(gap, '2026-11-10', '2026-11-20')).toEqual({ status: 'no_downloads' })
  })

  it('gives no ratio when nothing was expected', () => {
    const quiet = new Map(eachDay({ from: '2026-11-01', to: '2026-11-20' }).map((day) => [day, 0]))
    quiet.set('2026-11-10', 6)
    expect(downloadLift(quiet, '2026-11-10', '2026-11-20')).toMatchObject({
      status: 'ok',
      change: 6,
      changeRatio: null,
    })
  })
})
