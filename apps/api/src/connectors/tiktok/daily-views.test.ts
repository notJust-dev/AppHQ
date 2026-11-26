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

  it('does not start a post that was up before the connection from a reading of zero', () => {
    // TikTok gave no views for the video on the connection day and its real total a day later.
    const views = dailyViews({
      watchStart: '2026-11-10',
      through: '2026-11-12',
      posts: [
        {
          publishedOn: '2026-04-02',
          snapshots: [
            { date: '2026-11-10', views: 0 },
            { date: '2026-11-11', views: 80_000 },
            { date: '2026-11-12', views: 80_500 },
          ],
        },
      ],
    })
    // Its total is history, on the day it was posted, and only the growth after it is daily.
    expect(asObject(views)).toMatchObject({ '2026-04-02': 80_000, '2026-11-10': 0, '2026-11-11': 0, '2026-11-12': 500 })
  })

  it('counts a total that drops to zero and comes back only once', () => {
    const views = dailyViews({
      watchStart: '2026-11-10',
      through: '2026-11-12',
      posts: [
        {
          publishedOn: '2026-01-01',
          snapshots: [
            { date: '2026-11-10', views: 1_000 },
            { date: '2026-11-11', views: 0 },
            { date: '2026-11-12', views: 1_300 },
          ],
        },
      ],
    })
    // The 300 gained since the last good reading, over the two days since it.
    expect(asObject(views)).toMatchObject({ '2026-01-01': 1_000, '2026-11-11': 150, '2026-11-12': 150 })
    expect([...views.values()].reduce((sum, value) => sum + value, 0)).toBe(1_300)
  })

  it('counts no gain after a drop until the total is past its old one', () => {
    const views = dailyViews({
      watchStart: '2026-11-10',
      through: '2026-11-13',
      posts: [
        {
          publishedOn: '2026-01-01',
          snapshots: [
            { date: '2026-11-10', views: 1_000 },
            { date: '2026-11-11', views: 900 },
            { date: '2026-11-12', views: 980 },
            { date: '2026-11-13', views: 1_060 },
          ],
        },
      ],
    })
    expect(asObject(views)).toMatchObject({ '2026-01-01': 1_000, '2026-11-11': 20, '2026-11-12': 20, '2026-11-13': 20 })
  })

  it('believes a zero for a video posted on the connection day, or since', () => {
    const views = dailyViews({
      watchStart: '2026-11-10',
      through: '2026-11-12',
      posts: [
        {
          publishedOn: '2026-11-10',
          snapshots: [
            { date: '2026-11-10', views: 0 },
            { date: '2026-11-11', views: 400 },
          ],
        },
        {
          publishedOn: '2026-11-11',
          snapshots: [
            { date: '2026-11-11', views: 0 },
            { date: '2026-11-12', views: 90 },
          ],
        },
      ],
    })
    // Nobody had watched them yet when they were first read; what came after is daily.
    expect(asObject(views)).toEqual({ '2026-11-10': 0, '2026-11-11': 400, '2026-11-12': 90 })
  })

  it('keeps the post day of an older video that has no views at all', () => {
    const views = dailyViews({
      watchStart: '2026-11-10',
      through: '2026-11-11',
      posts: [
        {
          publishedOn: '2026-11-07',
          snapshots: [
            { date: '2026-11-10', views: 0 },
            { date: '2026-11-11', views: 0 },
          ],
        },
      ],
    })
    expect(asObject(views)).toEqual({
      '2026-11-07': 0,
      '2026-11-08': 0,
      '2026-11-09': 0,
      '2026-11-10': 0,
      '2026-11-11': 0,
    })
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
