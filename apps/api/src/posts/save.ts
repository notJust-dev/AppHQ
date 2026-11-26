import { and, eq, inArray, sql } from 'drizzle-orm'
import type { Scope } from '../organizations/scope.js'
import { postSnapshots, posts } from '../db/schema.js'
import type { IsoDate } from '../lib/dates.js'

const CHUNK = 500

/** A post as a connector read it, with its lifetime totals at that moment. */
export interface PostReading {
  platform: string
  externalId: string
  appId: string
  connectionId: string
  url: string | null
  caption: string | null
  publishedAt: Date
  durationSeconds: number | null
  views: number
  likes: number
  comments: number
  shares: number
}

/**
 * Saves posts with their latest totals, and the same totals as the day's snapshot. Re-reading a
 * post updates it; moving an account to another app moves its posts with it.
 */
export async function savePosts({ db, organizationId }: Scope, readings: PostReading[], today: IsoDate): Promise<number> {
  await db.transaction(async (tx) => {
    for (let i = 0; i < readings.length; i += CHUNK) {
      const saved = await tx
        .insert(posts)
        .values(readings.slice(i, i + CHUNK).map((reading) => ({ ...reading, organizationId })))
        .onConflictDoUpdate({
          target: [posts.organizationId, posts.platform, posts.externalId],
          set: {
            appId: sql`excluded.app_id`,
            connectionId: sql`excluded.connection_id`,
            url: sql`excluded.url`,
            caption: sql`excluded.caption`,
            durationSeconds: sql`excluded.duration_seconds`,
            views: sql`excluded.views`,
            likes: sql`excluded.likes`,
            comments: sql`excluded.comments`,
            shares: sql`excluded.shares`,
            updatedAt: sql`now()`,
          },
        })
        .returning({
          postId: posts.id,
          views: posts.views,
          likes: posts.likes,
          comments: posts.comments,
          shares: posts.shares,
        })

      await tx
        .insert(postSnapshots)
        .values(saved.map((post) => ({ ...post, organizationId, date: today })))
        .onConflictDoUpdate({
          target: [postSnapshots.postId, postSnapshots.date],
          set: {
            views: sql`excluded.views`,
            likes: sql`excluded.likes`,
            comments: sql`excluded.comments`,
            shares: sql`excluded.shares`,
            capturedAt: sql`now()`,
          },
        })
    }
  })
  return readings.length
}

/** Posts already stored for these ids, so a connector can skip re-reading old ones. */
export async function storedPosts({ db, organizationId }: Scope, platform: string, externalIds: string[]) {
  const found = new Map<string, { views: number; shares: number }>()
  for (let i = 0; i < externalIds.length; i += CHUNK) {
    const rows = await db
      .select({ externalId: posts.externalId, views: posts.views, shares: posts.shares })
      .from(posts)
      .where(
        and(eq(posts.organizationId, organizationId), eq(posts.platform, platform), inArray(posts.externalId, externalIds.slice(i, i + CHUNK))),
      )
    for (const row of rows) found.set(row.externalId, row)
  }
  return found
}
