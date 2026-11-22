import { describe, expect, it } from 'vitest'
import { buildTimeline, type MetricRow } from './get-app-timeline.js'

const days = ['2026-11-17', '2026-11-18', '2026-11-19']
const row = (date: string, source: string, metric: string, value: number): MetricRow => ({
  date,
  source,
  metric,
  value,
})
const series = (rows: MetricRow[], key: string) => {
  const found = buildTimeline(rows, days).find((entry) => entry.key === key)
  if (!found) throw new Error(`no series ${key}`)
  return found
}

describe('buildTimeline', () => {
  it('adds the sources of a row together, day by day', () => {
    const downloads = series(
      [
        row('2026-11-17', 'app_store', 'downloads', 10),
        row('2026-11-17', 'google_play', 'downloads', 4),
        row('2026-11-18', 'app_store', 'downloads', 12),
        row('2026-11-18', 'google_play', 'downloads', 3),
      ],
      'downloads',
    )
    expect(downloads.values).toEqual([14, 15, null])
    expect(downloads.summary).toBe(29)
    expect(downloads.completeThrough).toBeNull()
    expect(downloads.sources).toEqual([
      { source: 'app_store', values: [10, 12, null], summary: 22 },
      { source: 'google_play', values: [4, 3, null], summary: 7 },
    ])
  })

  it('ends a total where a slower source stops, instead of showing a drop', () => {
    const downloads = series(
      [
        row('2026-11-17', 'app_store', 'downloads', 10),
        row('2026-11-17', 'google_play', 'downloads', 4),
        row('2026-11-18', 'app_store', 'downloads', 12),
        row('2026-11-19', 'app_store', 'downloads', 11),
      ],
      'downloads',
    )
    expect(downloads.values).toEqual([14, null, null])
    expect(downloads.summary).toBe(14)
    expect(downloads.completeThrough).toBe('2026-11-17')
    expect(downloads.waitingFor).toEqual(['google_play'])
    // Each store's own days go as far as it reported; its summary covers the total's days.
    expect(downloads.sources.find((s) => s.source === 'app_store')).toMatchObject({
      values: [10, 12, 11],
      summary: 10,
    })
  })

  it('leaves a day nobody reported as a gap, but keeps a reported zero', () => {
    const downloads = series(
      [row('2026-11-17', 'app_store', 'downloads', 0), row('2026-11-19', 'app_store', 'downloads', 5)],
      'downloads',
    )
    expect(downloads.values).toEqual([0, null, 5])
  })

  it('sums up MRR as its latest value, not a total', () => {
    const mrr = series(
      [row('2026-11-17', 'revenuecat', 'mrr', 4000), row('2026-11-18', 'revenuecat', 'mrr', 4100)],
      'mrr',
    )
    expect(mrr.summary).toBe(4100)
  })

  it('rounds money to the cent', () => {
    const revenue = series(
      [row('2026-11-17', 'revenuecat', 'revenue', 0.1), row('2026-11-18', 'revenuecat', 'revenue', 0.2)],
      'revenue',
    )
    expect(revenue.summary).toBe(0.3)
  })

  it('ignores other metrics, other sources and days outside the range', () => {
    const views = series(
      [
        row('2026-11-17', 'tiktok', 'views', 100),
        row('2026-11-17', 'tiktok', 'likes', 9),
        row('2026-11-17', 'app_store', 'views', 50),
        row('2026-11-20', 'tiktok', 'views', 70),
      ],
      'socialViews',
    )
    expect(views.values).toEqual([100, null, null])
    expect(views.sources.map((source) => source.source)).toEqual(['tiktok'])
  })

  it('reports a row with no data at all as having no sources', () => {
    const pageViews = series([], 'pageViews')
    expect(pageViews.values).toEqual([null, null, null])
    expect(pageViews.summary).toBeNull()
    expect(pageViews.sources).toEqual([])
  })
})
