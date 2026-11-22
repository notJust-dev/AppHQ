import { and, desc, eq, gte, lt } from 'drizzle-orm'
import { z } from 'zod'
import { posts } from '../db/schema.js'
import { addDays } from '../lib/dates.js'
import { defineQuery } from './define.js'
import { checkRange, rangeFields } from './range.js'

export const listPosts = defineQuery({
  name: 'list_posts',
  description:
    "One app's social posts published in a date range, newest first. Each has its platform, " +
    'caption, link, publish time and lifetime totals (views, likes, comments, shares) as of ' +
    'the last sync. Totals keep growing after a post goes up, so older posts have had longer.',
  input: z
    .object({
      appId: z.string().min(1).max(64).describe('The app id from list_apps.'),
      ...rangeFields,
      limit: z.number().int().min(1).max(200).default(50).describe('At most this many posts.'),
    })
    .superRefine(checkRange),
  async handler({ db }, input) {
    const rows = await db
      .select({
        id: posts.id,
        platform: posts.platform,
        url: posts.url,
        caption: posts.caption,
        publishedAt: posts.publishedAt,
        durationSeconds: posts.durationSeconds,
        views: posts.views,
        likes: posts.likes,
        comments: posts.comments,
        shares: posts.shares,
        updatedAt: posts.updatedAt,
      })
      .from(posts)
      .where(
        and(
          eq(posts.appId, input.appId),
          gte(posts.publishedAt, new Date(`${input.from}T00:00:00Z`)),
          lt(posts.publishedAt, new Date(`${addDays(input.to, 1)}T00:00:00Z`)),
        ),
      )
      .orderBy(desc(posts.publishedAt))
      .limit(input.limit)

    return rows.map((row) => ({
      ...row,
      publishedAt: row.publishedAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }))
  },
})
