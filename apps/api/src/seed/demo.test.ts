import { describe, expect, it } from 'vitest'
import { generateDemoData } from './demo.js'

const options = { days: 60, endDate: '2026-11-19' }

describe('generateDemoData', () => {
  it('is deterministic for the same options', () => {
    expect(generateDemoData(options)).toEqual(generateDemoData(options))
  })

  it('covers every day for every app with non-negative numbers', () => {
    const { apps, metrics } = generateDemoData(options)
    const dates = new Set(metrics.map((m) => m.date))
    expect(dates.size).toBe(60)
    expect([...dates].sort().at(0)).toBe('2026-09-21')
    expect([...dates].sort().at(-1)).toBe('2026-11-19')

    const perAppPerDay = metrics.length / (apps.length * 60)
    expect(Number.isInteger(perAppPerDay)).toBe(true)
    expect(metrics.every((m) => Number.isFinite(m.value) && m.value >= 0)).toBe(true)
  })

  it('makes downloads follow social views', () => {
    const { metrics } = generateDemoData({ days: 120, endDate: '2026-11-19' })
    const series = (source: string, metric: string) =>
      metrics
        .filter((m) => m.appId === 'demo-habitloop' && m.source === source && m.metric === metric)
        .map((m) => m.value)

    const views = series('tiktok', 'views')
    const downloads = series('app_store', 'downloads')
    const peakDay = views.indexOf(Math.max(...views))
    const median = [...downloads].sort((a, b) => a - b)[Math.floor(downloads.length / 2)] ?? 0

    expect(Math.max(...views)).toBeGreaterThan(5 * (views.reduce((a, b) => a + b) / views.length))
    expect(downloads[peakDay]).toBeGreaterThan(1.5 * median)
  })
})
