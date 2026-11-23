import { describe, expect, it } from 'vitest'
import { dailyViews } from './daily-views.js'

const asObject = (map: Map<string, number>) => Object.fromEntries(map)

describe('dailyViews', () => {
  it('puts the views of posts that were up before watching started on their post day, then counts growth', () => {
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
    // Its views at the first reading go on the day it was posted, and the days after it up to the
    // connection have no post, so none. The connection day has no reading before it.
    const result = asObject(views)
    expect(result['2026-10-01']).toBe(50_000)
    expect(result['2026-10-02']).toBe(0)
    expect(result['2026-11-10']).toBe(0)
    expect(result).toMatchObject({ '2026-11-11': 300, '2026-11-12': 50 })
    expect(Object.keys(result)).toHaveLength(43)
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
    expect(asObject(views)).toMatchObject({ '2026-01-01': 100, '2026-11-11': 100, '2026-11-12': 100, '2026-11-13': 100 })
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
    // The first post's first reading (in date order) is 1,000, on the 10th.
    expect(asObject(views)).toMatchObject({ '2026-01-01': 1_000, '2026-01-02': 0, '2026-02-01': 10, '2026-11-11': 20 })
  })

  it('has the history on the day an account is connected, but no daily gain yet', () => {
    const views = dailyViews({
      watchStart: '2026-11-10',
      through: '2026-11-10',
      posts: [
        { publishedOn: '2026-11-10', snapshots: [{ date: '2026-11-10', views: 5 }] },
        { publishedOn: '2026-09-03', snapshots: [{ date: '2026-11-10', views: 7_000 }] },
      ],
    })
    expect(asObject(views)).toMatchObject({ '2026-09-03': 7_000, '2026-09-04': 0, '2026-11-10': 5 })
    // From the first post through the connection day, and nothing after it yet.
    expect(views.size).toBe(69)
  })

  it('zeroes days before watching started without a post, from the first post on, and adds posts on the same day', () => {
    const views = dailyViews({
      watchStart: '2026-11-10',
      through: '2026-11-11',
      posts: [
        { publishedOn: '2026-11-01', snapshots: [{ date: '2026-11-10', views: 400 }] },
        { publishedOn: '2026-11-01', snapshots: [{ date: '2026-11-10', views: 100 }] },
        { publishedOn: '2026-11-04', snapshots: [{ date: '2026-11-10', views: 0 }] },
      ],
    })
    // Nothing went up on the 2nd or 3rd, so no views sit there; nothing before the first post.
    expect(asObject(views)).toEqual({
      '2026-11-01': 500,
      '2026-11-02': 0,
      '2026-11-03': 0,
      '2026-11-04': 0,
      '2026-11-05': 0,
      '2026-11-06': 0,
      '2026-11-07': 0,
      '2026-11-08': 0,
      '2026-11-09': 0,
      '2026-11-10': 0,
      '2026-11-11': 0,
    })
  })

  it('counts every view exactly once, before and after watching started', () => {
    const posts = [
      {
        publishedOn: '2026-08-15',
        snapshots: [
          { date: '2026-11-10', views: 12_000 },
          { date: '2026-11-11', views: 12_500 },
          { date: '2026-11-13', views: 13_100 },
        ],
      },
      { publishedOn: '2026-11-12', snapshots: [{ date: '2026-11-13', views: 900 }] },
    ]
    const views = dailyViews({ watchStart: '2026-11-10', through: '2026-11-13', posts })
    const total = [...views.values()].reduce((sum, value) => sum + value, 0)
    // Every post's latest lifetime total, and no more.
    expect(total).toBe(13_100 + 900)
  })

  it('puts a post first read only after watching started on its post day too', () => {
    // The first sync failed: the post was up before the connection but read two days later.
    const views = dailyViews({
      watchStart: '2026-11-10',
      through: '2026-11-12',
      posts: [{ publishedOn: '2026-11-05', snapshots: [{ date: '2026-11-12', views: 2_000 }] }],
    })
    expect(asObject(views)).toMatchObject({ '2026-11-05': 2_000, '2026-11-06': 0, '2026-11-11': 0, '2026-11-12': 0 })
  })
})
