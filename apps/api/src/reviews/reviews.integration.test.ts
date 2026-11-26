import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '../db/client.js'
import { runMigrations } from '../db/migrate.js'
import { apps, reviews } from '../db/schema.js'
import { getReviewSummary, listReviews, reviewConditions } from '../queries/reviews.js'
import { testDatabaseUrl } from '../test/database.js'
import { defaultScope } from '../test/organizations.js'
import type { Scope } from '../organizations/scope.js'
import { markReviews, saveReviews, type ReviewReading } from './save.js'

// Runs only when a database is provided: TEST_DATABASE_URL=postgres://.../appdashboard_test
const url = testDatabaseUrl()

describe.skipIf(!url)('Reviews inbox, against a real database', () => {
  const { db, sql } = createDb(url ?? 'postgres://unused')
  const run = randomUUID().slice(0, 8)
  const appId = randomUUID()
  const now = new Date()
  let scope: Scope
  const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000)

  const reading = (id: string, overrides: Partial<ReviewReading> = {}): ReviewReading => ({
    appId,
    store: 'app_store',
    externalId: `${id}-${run}`,
    rating: 5,
    title: `Title ${id}`,
    body: `Body ${id}`,
    createdAt: daysAgo(1),
    ...overrides,
  })

  beforeAll(async () => {
    await runMigrations({ db, sql })
    scope = await defaultScope(db)
    await db.insert(apps).values({ organizationId: scope.organizationId, id: appId, name: 'Reviewed App' })
    await saveReviews(
      scope,
      [
        reading('new', { rating: 2, createdAt: daysAgo(1) }),
        reading('week', { rating: 4, createdAt: daysAgo(6), store: 'google_play' }),
        // A year of history arrives read.
        reading('old', { rating: 5, createdAt: daysAgo(200) }),
      ],
      now,
    )
  })

  afterAll(async () => {
    await db.delete(apps).where(and(eq(apps.organizationId, scope.organizationId), eq(apps.id, appId)))
    await sql.end({ timeout: 5 })
  })

  const mine = () =>
    db
      .select()
      .from(reviews)
      .where(and(eq(reviews.organizationId, scope.organizationId), eq(reviews.appId, appId)))

  it('leaves recent reviews unread and old ones read', async () => {
    const saved = await mine()
    const read = Object.fromEntries(saved.map((review) => [review.externalId.split('-')[0], review.readAt !== null]))
    expect(read).toEqual({ new: false, week: false, old: true })
  })

  it('makes an edited review unread again, but not a new reply', async () => {
    await markReviews(scope, eq(reviews.appId, appId), true)
    await saveReviews(scope, [reading('old', { rating: 5, createdAt: daysAgo(200), reply: 'Thank you!' })], now)
    expect((await mine()).every((review) => review.readAt !== null)).toBe(true)

    await saveReviews(scope, [reading('old', { rating: 1, body: 'Changed my mind', createdAt: daysAgo(200) })], now)
    const old = (await mine()).find((review) => review.externalId === `old-${run}`)
    expect(old).toMatchObject({ rating: 1, body: 'Changed my mind', readAt: null })
  })

  it('lists newest first, in pages, with filters', async () => {
    const first = await listReviews.handler(scope, { appId, limit: 2 })
    expect(first.reviews.map((review) => review.title)).toEqual(['Title new', 'Title week'])
    expect(first.reviews[0]).toMatchObject({ appName: 'Reviewed App', read: true })
    expect(first.next).not.toBeNull()

    const second = await listReviews.handler(scope, { appId, limit: 2, before: first.next ?? undefined })
    expect(second.reviews.map((review) => review.title)).toEqual(['Title old'])
    expect(second.next).toBeNull()

    const play = await listReviews.handler(scope, { appId, store: 'google_play', limit: 30 })
    expect(play.reviews.map((review) => review.title)).toEqual(['Title week'])
    const unread = await listReviews.handler(scope, { appId, unread: true, limit: 30 })
    expect(unread.reviews.map((review) => review.title)).toEqual(['Title old'])
  })

  it('sums the ratings up', async () => {
    const summary = await getReviewSummary.handler(scope, { appId })
    expect(summary.total).toBe(3)
    // Ratings 2, 4 and 1 (the edited one).
    expect(summary.average).toBe(2.33)
    expect(summary.distribution).toEqual([
      { rating: 5, count: 0 },
      { rating: 4, count: 1 },
      { rating: 3, count: 0 },
      { rating: 2, count: 1 },
      { rating: 1, count: 1 },
    ])
    expect(summary.unread).toBe(1)
    expect(summary.recent).toEqual({ count: 2, average: 3 })
  })

  it('marks by id or by filter, counting only the ones that change', async () => {
    expect(await markReviews(scope, reviewConditions(scope.organizationId, { appId }), true)).toBe(1)
    expect(await markReviews(scope, reviewConditions(scope.organizationId, { appId }), true)).toBe(0)
    const [newest] = (await mine()).filter((review) => review.externalId === `new-${run}`)
    expect(await markReviews(scope, undefined, false, [newest?.id ?? ''])).toBe(1)
    expect((await getReviewSummary.handler(scope, { appId })).unread).toBe(1)
  })
})
