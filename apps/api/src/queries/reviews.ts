import { and, count, desc, eq, gte, isNull, lt, or, sql, type SQL } from 'drizzle-orm'
import { z } from 'zod'
import { apps, reviews } from '../db/schema.js'
import { defineQuery } from './define.js'

export const REVIEW_STORES = ['app_store', 'google_play'] as const

/** The filters every review query and the bulk "mark read" share. */
export const reviewFilters = {
  appId: z.uuid().optional().describe('Only this app (an id from list_apps).'),
  store: z.enum(REVIEW_STORES).optional().describe('Only this store.'),
  rating: z.number().int().min(1).max(5).optional().describe('Only reviews with this many stars.'),
  unread: z.boolean().optional().describe('Only reviews not marked read in the dashboard.'),
}

export type ReviewFilters = { appId?: string; store?: (typeof REVIEW_STORES)[number]; rating?: number; unread?: boolean }

/** One organization's reviews matching the filters. */
export function reviewConditions(organizationId: string, filters: ReviewFilters): SQL | undefined {
  return and(
    eq(reviews.organizationId, organizationId),
    filters.appId ? eq(reviews.appId, filters.appId) : undefined,
    filters.store ? eq(reviews.store, filters.store) : undefined,
    filters.rating ? eq(reviews.rating, filters.rating) : undefined,
    filters.unread ? isNull(reviews.readAt) : undefined,
  )
}

export const listReviews = defineQuery({
  name: 'list_reviews',
  description:
    'Written App Store and Google Play reviews, newest first, with the app, store, star rating, ' +
    'title and text, the reviewer (App Store nickname) or language and device (Google Play), ' +
    'the app version, the developer reply if any, and whether it is marked read in the ' +
    'dashboard. Page with `before`, the `next` cursor of the previous page.',
  input: z.object({
    ...reviewFilters,
    before: z.object({ createdAt: z.iso.datetime(), id: z.uuid() }).optional().describe('The `next` cursor of the previous page.'),
    limit: z.number().int().min(1).max(100).default(30),
  }),
  async handler(scope, input) {
    return scope.run(async (db) => {
      const { organizationId } = scope
      const cursor = input.before
        ? or(
            lt(reviews.createdAt, new Date(input.before.createdAt)),
            and(eq(reviews.createdAt, new Date(input.before.createdAt)), lt(reviews.id, input.before.id)),
          )
        : undefined
      const rows = await db
        .select({
          id: reviews.id,
          appId: reviews.appId,
          appName: apps.name,
          store: reviews.store,
          rating: reviews.rating,
          title: reviews.title,
          body: reviews.body,
          author: reviews.author,
          territory: reviews.territory,
          language: reviews.language,
          appVersion: reviews.appVersion,
          device: reviews.device,
          url: reviews.url,
          reply: reviews.reply,
          repliedAt: reviews.repliedAt,
          createdAt: reviews.createdAt,
          editedAt: reviews.editedAt,
          readAt: reviews.readAt,
        })
        .from(reviews)
        .innerJoin(apps, and(eq(apps.organizationId, reviews.organizationId), eq(apps.id, reviews.appId)))
        .where(and(reviewConditions(organizationId, input), cursor))
        .orderBy(desc(reviews.createdAt), desc(reviews.id))
        .limit(input.limit + 1)

      const page = rows.slice(0, input.limit)
      const last = page.at(-1)
      return {
        reviews: page.map((row) => ({
          ...row,
          createdAt: row.createdAt.toISOString(),
          editedAt: row.editedAt?.toISOString() ?? null,
          repliedAt: row.repliedAt?.toISOString() ?? null,
          read: row.readAt !== null,
          readAt: undefined,
        })),
        next: rows.length > input.limit && last ? { createdAt: last.createdAt.toISOString(), id: last.id } : null,
      }
    })
  },
})

/** Days in each window of the recent comparison. */
const RECENT_DAYS = 30

export const getReviewSummary = defineQuery({
  name: 'get_review_summary',
  description:
    'Where the written reviews stand, for one app or store or all: how many, the average star ' +
    `rating, how many have each rating, how many are unread, and the last ${RECENT_DAYS} days ` +
    `against the ${RECENT_DAYS} before (count and average).`,
  input: z.object({ appId: reviewFilters.appId, store: reviewFilters.store }),
  async handler(scope, input) {
    return scope.run(async (db) => {
      const { organizationId } = scope
      const where = reviewConditions(organizationId, input)
      const now = Date.now()
      const recentFrom = new Date(now - RECENT_DAYS * 86_400_000)
      const previousFrom = new Date(now - 2 * RECENT_DAYS * 86_400_000)

      const [byRating, [unread], [recent], [previous]] = await Promise.all([
        db.select({ rating: reviews.rating, count: count() }).from(reviews).where(where).groupBy(reviews.rating),
        db.select({ count: count() }).from(reviews).where(and(where, isNull(reviews.readAt))),
        db
          .select({ count: count(), average: sql<string | null>`avg(${reviews.rating})` })
          .from(reviews)
          .where(and(where, gte(reviews.createdAt, recentFrom))),
        db
          .select({ count: count(), average: sql<string | null>`avg(${reviews.rating})` })
          .from(reviews)
          .where(and(where, gte(reviews.createdAt, previousFrom), lt(reviews.createdAt, recentFrom))),
      ])

      const distribution = [5, 4, 3, 2, 1].map((stars) => ({
        rating: stars,
        count: byRating.find((row) => row.rating === stars)?.count ?? 0,
      }))
      const total = distribution.reduce((sum, row) => sum + row.count, 0)
      const average = total === 0 ? null : distribution.reduce((sum, row) => sum + row.rating * row.count, 0) / total
      const round = (value: string | null | undefined) => (value == null ? null : Math.round(Number(value) * 100) / 100)

      return {
        total,
        average: average === null ? null : Math.round(average * 100) / 100,
        distribution,
        unread: unread?.count ?? 0,
        recentDays: RECENT_DAYS,
        recent: { count: recent?.count ?? 0, average: round(recent?.average) },
        previous: { count: previous?.count ?? 0, average: round(previous?.average) },
      }
    })
  },
})
