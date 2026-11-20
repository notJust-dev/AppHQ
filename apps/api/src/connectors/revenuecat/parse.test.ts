import { describe, expect, it } from 'vitest'
import { chartSchema } from './client.js'
import { toDailySeries } from './parse.js'

const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 1000

// Shaped like a RevenueCat chart response, with made-up numbers.
const revenueChart = chartSchema.parse({
  object: 'chart_data',
  resolution: 'day',
  yaxis_currency: 'USD',
  measures: [
    { display_name: 'Transactions', unit: '#' },
    { display_name: 'Revenue', unit: '$' },
  ],
  values: [
    { cohort: day('2026-11-17'), measure: 0, value: 12 },
    { cohort: day('2026-11-17'), measure: 1, value: 84.5 },
    { cohort: day('2026-11-18'), measure: 0, value: 9 },
    { cohort: day('2026-11-18'), measure: 1, value: null },
    { cohort: day('2026-11-19'), measure: 0, value: 4 },
    { cohort: day('2026-11-19'), measure: 1, value: 31.25, incomplete: true },
  ],
})

describe('toDailySeries', () => {
  it('reads the measure chosen by name, not by position', () => {
    const series = toDailySeries(revenueChart, /^revenue$/i)
    expect(series.measure).toBe('Revenue')
    expect(series.fallback).toBe(false)
    expect(series.points).toEqual([
      { date: '2026-11-17', value: 84.5, incomplete: false },
      // 2026-11-18 had no value and is left out rather than stored as zero.
      { date: '2026-11-19', value: 31.25, incomplete: true },
    ])
  })

  it('falls back to the first measure and says so when no name matches', () => {
    const series = toDailySeries(revenueChart, /proceeds/i)
    expect(series.measure).toBe('Transactions')
    expect(series.fallback).toBe(true)
    expect(series.points.map((point) => point.value)).toEqual([12, 9, 4])
  })

  it('reads a single-measure chart that does not label its points', () => {
    const chart = chartSchema.parse({
      measures: [{ display_name: 'MRR' }],
      values: [{ cohort: day('2026-11-19'), value: 4200 }],
    })
    const series = toDailySeries(chart, /mrr/i)
    expect(series.fallback).toBe(false)
    expect(series.points).toEqual([{ date: '2026-11-19', value: 4200, incomplete: false }])
  })

  it('ignores per-segment points', () => {
    const chart = chartSchema.parse({
      measures: [{ display_name: 'Revenue' }],
      values: [
        { cohort: day('2026-11-19'), measure: 0, value: 100 },
        { cohort: day('2026-11-19'), measure: 0, segment: 1, value: 60 },
      ],
    })
    expect(toDailySeries(chart, /revenue/i).points).toHaveLength(1)
  })
})
