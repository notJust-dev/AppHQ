import { randomUUID } from 'node:crypto'
import { inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '../db/client.js'
import { runMigrations } from '../db/migrate.js'
import { apps, posts } from '../db/schema.js'
import { upsertMetrics } from '../metrics/upsert.js'
import { testDatabaseUrl } from '../test/database.js'
import { getMonetisationPerformance, getSocialPerformance, getStorePerformance } from './performance.js'

// Runs only when a database is provided: TEST_DATABASE_URL=postgres://.../appdashboard_test
const url = testDatabaseUrl()

describe.skipIf(!url)('Performance pages, against a real database', () => {
  const { db, sql } = createDb(url ?? 'postgres://unused')
  const suffix = randomUUID().slice(0, 8)
  const one = `perf-one-${suffix}`
  const two = `perf-two-${suffix}`
  // The range, and the week before it for comparison.
  const range = { from: '2026-10-08', to: '2026-10-14' }

  beforeAll(async () => {
    await runMigrations({ db, sql })
    await db.insert(apps).values([
      { id: one, name: 'Perf One' },
      { id: two, name: 'Perf Two' },
    ])
    const metrics = []
    for (let day = 1; day <= 14; day++) {
      const date = `2026-10-${String(day).padStart(2, '0')}`
      metrics.push(
        { appId: one, date, source: 'tiktok', metric: 'views', value: 100 },
        { appId: one, date, source: 'tiktok', metric: 'followers', value: 1000 + day },
        { appId: two, date, source: 'instagram', metric: 'views', value: 50 },
        { appId: one, date, source: 'app_store', metric: 'downloads', value: 10 },
        { appId: one, date, source: 'app_store', metric: 'page_views', value: 30 },
        { appId: one, date, source: 'app_store', metric: 'impressions', value: 90 },
        { appId: two, date, source: 'google_play', metric: 'downloads', value: 4 },
        { appId: two, date, source: 'google_play', metric: 'page_views', value: 20 },
        { appId: one, date, source: 'revenuecat', metric: 'revenue', value: 2.5 },
        { appId: one, date, source: 'revenuecat', metric: 'mrr', value: 100 + day },
      )
    }
    await upsertMetrics(db, metrics)
    await db.insert(posts).values([
      {
        platform: 'tiktok',
        externalId: `perf-a-${suffix}`,
        appId: one,
        publishedAt: new Date('2026-10-09T12:00:00Z'),
        views: 5000,
        likes: 300,
      },
      {
        platform: 'tiktok',
        externalId: `perf-b-${suffix}`,
        appId: one,
        publishedAt: new Date('2026-10-12T12:00:00Z'),
        views: 800,
      },
      // Before the range: not counted.
      {
        platform: 'instagram',
        externalId: `perf-c-${suffix}`,
        appId: two,
        publishedAt: new Date('2026-10-02T12:00:00Z'),
        views: 9000,
      },
    ])
  })

  afterAll(async () => {
    await db.delete(apps).where(inArray(apps.id, [one, two]))
    await sql.end({ timeout: 5 })
  })

  const series = <T extends { series: { key: string }[] }>(result: T, key: string) =>
    result.series.find((entry) => entry.key === key) as (T['series'][number] & {
      summary: number | null
      previous: number | null
      sources: { source: string; summary: number | null; previous: number | null }[]
    }) | undefined

  it('sums the chosen apps, with the period before for comparison', async () => {
    const both = await getSocialPerformance.handler({ db }, { ...range, appId: undefined })
    const views = series(both, 'views')
    // Other apps in the test database may add to "all apps"; these two at least are counted.
    expect(views?.summary).toBeGreaterThanOrEqual(7 * 150)

    const single = await getSocialPerformance.handler({ db }, { ...range, appId: one })
    expect(series(single, 'views')?.summary).toBe(700)
    expect(series(single, 'views')?.previous).toBe(700)
    // Followers are a level: the latest value, not a total.
    expect(series(single, 'followers')?.summary).toBe(1014)
    expect(single.apps.map((entry) => entry.app.id)).toEqual([one])
  })

  it('counts the posts of the range by platform and ranks them by views', async () => {
    const result = await getSocialPerformance.handler({ db }, { ...range, appId: one })
    expect(result.posts.byPlatform).toEqual([
      { platform: 'tiktok', posts: 2, views: 5800, likes: 300, comments: 0, shares: 0 },
    ])
    expect(result.posts.top.map((post) => post.views)).toEqual([5000, 800])
    expect(result.posts.top[0]?.appName).toBe('Perf One')
    // Steady downloads before and after: no lift.
    expect(result.posts.top[0]?.downloadLift).toMatchObject({ status: 'ok', change: 0 })
    const perDay = result.posts.perDay.find((entry) => entry.platform === 'tiktok')?.values
    expect(perDay).toEqual([0, 1, 0, 0, 1, 0, 0])
  })

  it('splits the store funnel by store', async () => {
    const result = await getStorePerformance.handler({ db }, { ...range, appId: two })
    expect(series(result, 'impressions')?.summary).toBeNull()
    expect(series(result, 'pageViews')?.sources).toMatchObject([{ source: 'google_play', summary: 140 }])
    expect(series(result, 'downloads')?.summary).toBe(28)
    // 4 downloads per 20 page views each day, from the one store that reports both.
    expect(result.conversion).toEqual(Array(7).fill(0.2))
    expect(result.apps[0]?.bySource.downloads).toEqual({ google_play: 28 })
    expect(result.apps[0]?.previous.downloads).toBe(28)
  })

  it('takes the latest MRR and totals revenue', async () => {
    const result = await getMonetisationPerformance.handler({ db }, { ...range, appId: one })
    expect(series(result, 'revenue')?.summary).toBe(17.5)
    expect(series(result, 'mrr')?.summary).toBe(114)
    expect(series(result, 'mrr')?.previous).toBe(107)
    expect(result.apps[0]?.totals).toMatchObject({ revenue: 17.5, mrr: 114, downloads: 70 })
  })
})
