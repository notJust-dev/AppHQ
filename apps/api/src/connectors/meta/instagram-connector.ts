import { addDays, eachDay, todayUtc, type IsoDate } from '../../lib/dates.js'
import { mapLimit } from '../../lib/pool.js'
import { upsertMetrics } from '../../metrics/upsert.js'
import { savePosts, storedPosts, type PostReading } from '../../posts/save.js'
import type { AppConnector } from '../types.js'
import { MetaError, createMetaClient } from './client.js'
import { INSTAGRAM, metaConfig, requireMetaConfig } from './config.js'
import { parseMetaTime } from './days.js'
import {
  DailyTotals,
  FRESH_POST_DAYS,
  POST_HISTORY_DAYS,
  describe,
  isPartial,
  markAccount,
  metaConnections,
} from './shared.js'

/** Meta keeps 90 days of Instagram account insights. */
const VIEWS_HISTORY_DAYS = 90

/**
 * The Instagram accounts connected to an app: daily views from account insights (one request
 * per day, since `views` only comes as a total), followers, and media with their lifetime views,
 * likes, comments and shares.
 */
export function createInstagramConnector(
  options: { fetch?: typeof fetch; now?: () => Date; env?: NodeJS.ProcessEnv } = {},
): AppConnector {
  const now = options.now ?? (() => new Date())

  return {
    source: INSTAGRAM,
    scope: 'app',

    async isConfigured(app, db) {
      if (!metaConfig(options.env)) return false
      return (await metaConnections(db, INSTAGRAM, app.id)).length > 0
    },

    async sync({ db, app, range, log, secrets }) {
      const client = createMetaClient({ config: requireMetaConfig(options.env), fetch: options.fetch })
      const today = todayUtc(now())
      const from = range.from > addDays(today, -(VIEWS_HISTORY_DAYS - 1))
        ? range.from
        : addDays(today, -(VIEWS_HISTORY_DAYS - 1))
      const totals = new DailyTotals()
      const failures: string[] = []
      const warnings: string[] = []
      let rowsWritten = 0
      let followersComplete = true

      const accounts = await metaConnections(db, INSTAGRAM, app.id)
      for (const account of accounts) {
        const name = account.displayName ?? 'Instagram account'
        if (account.status === 'needs_reauth' || !account.accessTokenEnc) {
          failures.push(`${name} has to be connected again`)
          followersComplete = false
          continue
        }
        try {
          const igId = account.externalAccountId ?? ''
          // Without a linked Page both places hold the same sign-in token; try it once.
          const call = tokenFallback([
            ...new Set([
              secrets.decrypt(account.accessTokenEnc),
              ...(account.refreshTokenEnc ? [secrets.decrypt(account.refreshTokenEnc)] : []),
            ]),
          ])

          const profile = await call((token) => client.instagramAccount(token, igId))
          if (typeof profile.followers_count === 'number') {
            totals.add('followers', today, profile.followers_count)
          } else {
            followersComplete = false
          }

          const days = from <= range.to ? eachDay({ from, to: range.to }) : []
          await mapLimit(days, 4, async (day) => {
            try {
              const views = await call((token) => client.instagramViews(token, igId, day))
              if (views !== null) totals.add('views', day, views)
            } catch (err) {
              if (!isPartial(err)) throw err
              warnings.push(`${name} views ${day}: ${describe(err)}`)
            }
          })

          const readings = await readMedia({ call, client, igId, today, appId: app.id, connectionId: account.id, db, warnings, name })
          rowsWritten += await savePosts(db, readings, today)
          await markAccount(db, account.id, {
            ok: true,
            now: now(),
            ...(profile.username ? { displayName: `@${profile.username}` } : {}),
          })
        } catch (err) {
          followersComplete = false
          await markAccount(db, account.id, { ok: false, err, now: now() })
          failures.push(`${name}: ${describe(err)}`)
        }
      }

      let rows = totals.rows(app.id, INSTAGRAM)
      // A partial follower total would look like a drop, so it is only written when complete.
      if (!followersComplete) rows = rows.filter((row) => row.metric !== 'followers')
      rowsWritten += await upsertMetrics(db, rows)
      for (const warning of warnings.slice(0, 5)) log.warn(`instagram ${app.id}: ${warning}`)
      if (failures.length > 0) {
        throw new Error(`${failures.length} of ${accounts.length} Instagram accounts failed. ${failures.join('; ')}`)
      }
      return { rowsWritten }
    },
  }
}

/**
 * Runs calls with the first token that works. Instagram accounts carry the linked Page's token,
 * which does not expire, and the person's token, which lasts about 60 days; Meta documents the
 * second, so it is the fallback when the Page token is refused.
 */
function tokenFallback(tokens: string[]) {
  let working = 0
  return async <T>(work: (token: string) => Promise<T>): Promise<T> => {
    for (let i = working; ; i++) {
      const token = tokens[i]
      if (token === undefined) throw new Error('No Instagram token is stored for this account')
      try {
        const result = await work(token)
        working = i
        return result
      } catch (err) {
        const refused = err instanceof MetaError && (err.isAuthProblem || err.isPermissionProblem)
        if (!refused || i >= tokens.length - 1) throw err
      }
    }
  }
}

async function readMedia(ctx: {
  call: ReturnType<typeof tokenFallback>
  client: ReturnType<typeof createMetaClient>
  igId: string
  today: IsoDate
  appId: string
  connectionId: string
  db: Parameters<typeof storedPosts>[0]
  warnings: string[]
  name: string
}): Promise<PostReading[]> {
  const since = Date.parse(`${addDays(ctx.today, -POST_HISTORY_DAYS)}T00:00:00Z`)
  const freshSince = Date.parse(`${addDays(ctx.today, -FRESH_POST_DAYS)}T00:00:00Z`)
  const media = await ctx.call((token) => ctx.client.instagramMedia(token, ctx.igId, since))
  const stored = await storedPosts(ctx.db, INSTAGRAM, media.map((item) => item.id))

  let insightFailures = 0
  const readings: PostReading[] = []
  for (const item of media) {
    const at = parseMetaTime(item.timestamp)
    const known = stored.get(item.id)
    let insights: Record<string, number> = {}
    if (!known || at.getTime() >= freshSince) {
      try {
        insights = await ctx.call((token) =>
          ctx.client.mediaInsights(token, item.id, item.media_product_type),
        )
      } catch (err) {
        if (!isPartial(err)) throw err
        insightFailures++
      }
    }
    readings.push({
      platform: INSTAGRAM,
      externalId: item.id,
      appId: ctx.appId,
      connectionId: ctx.connectionId,
      url: item.permalink ?? null,
      caption: item.caption ?? null,
      publishedAt: at,
      durationSeconds: null,
      views: insights.views ?? known?.views ?? 0,
      likes: item.like_count ?? 0,
      comments: item.comments_count ?? 0,
      shares: insights.shares ?? known?.shares ?? 0,
    })
  }
  if (insightFailures > 0) ctx.warnings.push(`${ctx.name}: views missing for ${insightFailures} posts`)
  return readings
}
