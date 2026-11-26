import { and, eq, inArray, isNotNull, isNull, sql, type SQL } from 'drizzle-orm'
import type { Scope } from '../organizations/scope.js'
import { reviews, type NewReview } from '../db/schema.js'

const CHUNK = 500

/** A review older than this when first imported arrives read; newer ones wait in the inbox. */
export const UNREAD_DAYS = 14

/** A review as a connector read it from a store. */
export type ReviewReading = Omit<NewReview, 'id' | 'organizationId' | 'readAt' | 'fetchedAt'>

/**
 * Saves reviews, updating any already saved. A new review arrives unread when it is recent; an
 * old one (a year of history read on connect) arrives read. A review whose rating, title or
 * text changed becomes unread again; a new developer reply does not.
 */
export async function saveReviews(
  scope: Scope,
  readings: ReviewReading[],
  now: Date = new Date(),
): Promise<number> {
  const { organizationId } = scope
  const cutoff = new Date(now.getTime() - UNREAD_DAYS * 86_400_000)
  if (readings.length === 0) return 0
  await scope.run(async (db) => {
    for (let i = 0; i < readings.length; i += CHUNK) {
      await db
        .insert(reviews)
        .values(
          readings.slice(i, i + CHUNK).map((reading) => ({
            ...reading,
            organizationId,
            readAt: reading.createdAt < cutoff ? now : null,
            fetchedAt: now,
          })),
        )
        .onConflictDoUpdate({
          target: [reviews.organizationId, reviews.store, reviews.externalId],
          set: {
            appId: sql`excluded.app_id`,
            rating: sql`excluded.rating`,
            title: sql`excluded.title`,
            body: sql`excluded.body`,
            author: sql`excluded.author`,
            territory: sql`excluded.territory`,
            language: sql`excluded.language`,
            appVersion: sql`excluded.app_version`,
            device: sql`excluded.device`,
            url: sql`excluded.url`,
            reply: sql`excluded.reply`,
            repliedAt: sql`excluded.replied_at`,
            editedAt: sql`excluded.edited_at`,
            fetchedAt: sql`excluded.fetched_at`,
            readAt: sql`case when ${reviews.rating} <> excluded.rating
              or ${reviews.title} is distinct from excluded.title
              or ${reviews.body} is distinct from excluded.body
              then null else ${reviews.readAt} end`,
          },
        })
    }
  })
  return readings.length
}

/**
 * Marks reviews read or unread: the ones given by id, or every review matching `where` (a bulk
 * "mark all read" over the inbox's filters). Returns how many changed.
 */
export async function markReviews(
  scope: Scope,
  where: SQL | undefined,
  read: boolean,
  ids?: string[],
): Promise<number> {
  const { organizationId } = scope
  const changed = await scope.run((db) => db
    .update(reviews)
    .set({ readAt: read ? new Date() : null })
    .where(
      and(
        eq(reviews.organizationId, organizationId),
        ids ? inArray(reviews.id, ids) : where,
        // Only the ones whose state changes, so the count means something.
        read ? isNull(reviews.readAt) : isNotNull(reviews.readAt),
      ),
    )
    .returning({ id: reviews.id }))
  return changed.length
}
