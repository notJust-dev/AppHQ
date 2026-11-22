import { describe, expect, it } from 'vitest'
import { dailyViews } from './daily-views.js'

const asObject = (map: Map<string, number>) => Object.fromEntries(map)

describe('dailyViews', () => {
  it('counts only the growth of posts that were up before watching started', () => {
    const views = dailyViews({
      watchStart: '2026-11-10',
      through: '2026-11-12',
      posts: [
        {
          publishedOn: '2026-10-01',
          snapshots: [
            { date: '2026-11-10', views: 50_000 },
            { date: '2026-11-11', views: 50_300 },
            { date: '2026-11-12', views: 50_350 },
          ],
        },
      ],
    })
    // The connection day itself has no reading before it, so it is not reported.
    expect(asObject(views)).toEqual({ '2026-11-11': 300, '2026-11-12': 50 })
  })

  it('counts a new post in full, spread from publishing to its first reading', () => {
    const views = dailyViews({
      watchStart: '2026-11-10',
      through: '2026-11-14',
      posts: [
        {
          publishedOn: '2026-11-12',
          snapshots: [
            { date: '2026-11-13', views: 1_000 },
            { date: '2026-11-14', views: 1_600 },
          ],
        },
      ],
    })
    expect(asObject(views)).toEqual({
      '2026-11-11': 0,
      '2026-11-12': 500,
      '2026-11-13': 500,
      '2026-11-14': 600,
    })
  })

  it('shares a gain evenly over days without a reading', () => {
    const views = dailyViews({
      watchStart: '2026-11-10',
      through: '2026-11-13',
      posts: [
        {
          publishedOn: '2026-01-01',
          snapshots: [
            { date: '2026-11-10', views: 100 },
            { date: '2026-11-13', views: 400 },
          ],
        },
      ],
    })
    expect(asObject(views)).toEqual({ '2026-11-11': 100, '2026-11-12': 100, '2026-11-13': 100 })
  })

  it('treats a total that drops as no gain, and sums posts', () => {
    const views = dailyViews({
      watchStart: '2026-11-10',
      through: '2026-11-11',
      posts: [
        {
          publishedOn: '2026-01-01',
          snapshots: [
            { date: '2026-11-11', views: 900 },
            { date: '2026-11-10', views: 1_000 },
          ],
        },
        {
          publishedOn: '2026-02-01',
          snapshots: [
            { date: '2026-11-10', views: 10 },
            { date: '2026-11-11', views: 30 },
          ],
        },
      ],
    })
    expect(asObject(views)).toEqual({ '2026-11-11': 20 })
  })

  it('reports nothing on the day an account is connected', () => {
    const views = dailyViews({
      watchStart: '2026-11-10',
      through: '2026-11-10',
      posts: [{ publishedOn: '2026-11-10', snapshots: [{ date: '2026-11-10', views: 5 }] }],
    })
    expect(views.size).toBe(0)
  })
})
