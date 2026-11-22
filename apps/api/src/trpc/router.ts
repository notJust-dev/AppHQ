import { TRPCError, initTRPC } from '@trpc/server'
import { z } from 'zod'
import { AppStoreError } from '../connectors/app-store/client.js'
import { APP_STORE, APP_STORE_HISTORY_DAYS } from '../connectors/app-store/connector.js'
import { connectors } from '../connectors/registry.js'
import { RevenueCatError } from '../connectors/revenuecat/client.js'
import { REVENUECAT } from '../connectors/revenuecat/connector.js'
import { MetaError, createMetaClient } from '../connectors/meta/client.js'
import { FACEBOOK, MetaNotConfiguredError, metaConfig } from '../connectors/meta/config.js'
import { TikTokError, createTikTokClient } from '../connectors/tiktok/client.js'
import { TIKTOK, TikTokNotConfiguredError, tiktokConfig } from '../connectors/tiktok/config.js'
import type { Sql } from '../db/client.js'
import { MissingEncryptionKeyError, type Secrets } from '../lib/crypto.js'
import { trailingRange } from '../lib/dates.js'
import type { Logger } from '../lib/logger.js'
import type { QueryContext } from '../queries/define.js'
import { getAppTimeline } from '../queries/get-app-timeline.js'
import { getOverview } from '../queries/get-overview.js'
import { getSyncStatus } from '../queries/get-sync-status.js'
import { listAccounts } from '../queries/list-accounts.js'
import { listApps } from '../queries/list-apps.js'
import { listAssets } from '../queries/list-assets.js'
import { listPosts } from '../queries/list-posts.js'
import {
  getMonetisationPerformance,
  getSearchPerformance,
  getSocialPerformance,
  getStorePerformance,
} from '../queries/performance.js'
import { connectSearchConsole } from '../services/connect-search-console.js'
import { connectYouTube } from '../services/connect-youtube.js'
import { YouTubeError, createYouTubeClient } from '../connectors/youtube/client.js'
import { YouTubeNotConfiguredError, youtubeConfig } from '../connectors/youtube/config.js'
import { searchTop } from '../services/search-top.js'
import { SEARCH_CONSOLE, SEARCH_CONSOLE_HISTORY_DAYS, SearchConsoleError } from '../connectors/search-console/client.js'
import { getReviewSummary, listReviews, reviewConditions, reviewFilters } from '../queries/reviews.js'
import { markReviews } from '../reviews/save.js'
import { count, isNull } from 'drizzle-orm'
import { reviews as reviewsTable } from '../db/schema.js'
import { clearDemo, seedDemo } from '../seed/demo.js'
import { ConnectInputError, connectAppStore } from '../services/connect-app-store.js'
import { connectRevenueCat } from '../services/connect-revenuecat.js'
import {
  GOOGLE_PLAY,
  GOOGLE_PLAY_HISTORY_DAYS,
} from '../connectors/google-play/connector.js'
import { connectGooglePlay } from '../services/connect-google-play.js'
import { connectMeta } from '../services/connect-meta.js'
import { ASSET_KINDS, isAssetKind } from '../assets/kinds.js'
import { assignAsset, createApp, removeApp, renameApp, setIgnored } from '../assets/store.js'
import { connectTikTok } from '../services/connect-tiktok.js'
import { startSync } from '../sync/background.js'

/** Everything a procedure can use. Read-only queries only need the `db` part. */
export interface ApiContext extends QueryContext {
  sql: Sql
  secrets: Secrets
  log: Logger
}

/** How much history to fetch when an app is first connected. */
const BACKFILL_DAYS = 400

const t = initTRPC.context<ApiContext>().create()

/** Turns a failure to connect a source into a message that is safe and useful to show. */
function connectError(err: unknown): TRPCError {
  if (err instanceof MissingEncryptionKeyError) {
    return new TRPCError({ code: 'PRECONDITION_FAILED', message: err.message })
  }
  if (err instanceof ConnectInputError) {
    return new TRPCError({ code: 'BAD_REQUEST', message: err.message })
  }
  if (err instanceof TikTokNotConfiguredError || err instanceof MetaNotConfiguredError || err instanceof YouTubeNotConfiguredError) {
    return new TRPCError({ code: 'PRECONDITION_FAILED', message: err.message })
  }
  if (err instanceof MetaError) {
    if (err.code === 101 || err.code === 1) {
      return new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Facebook did not accept the app credentials. Check META_APP_ID and META_APP_SECRET on the api app.',
      })
    }
    if (err.code === 100 && /code|verification/i.test(err.message)) {
      return new TRPCError({
        code: 'BAD_REQUEST',
        message: 'The Facebook sign-in expired or was already used. Connect again.',
      })
    }
    return new TRPCError({
      code: 'BAD_REQUEST',
      message: `Facebook rejected the connection (${err.code}): ${err.message}`,
    })
  }
  if (err instanceof TikTokError) {
    if (err.code === 'invalid_client' || err.code === 'unauthorized_client') {
      return new TRPCError({
        code: 'BAD_REQUEST',
        message:
          'TikTok did not accept the app credentials. Check TIKTOK_CLIENT_KEY and ' +
          'TIKTOK_CLIENT_SECRET on the api app; a sandbox has its own pair.',
      })
    }
    if (err.code === 'invalid_grant') {
      return new TRPCError({
        code: 'BAD_REQUEST',
        message: 'The TikTok sign-in expired or was already used. Connect again.',
      })
    }
    return new TRPCError({
      code: 'BAD_REQUEST',
      message: `TikTok rejected the connection (${err.code}): ${err.message}`,
    })
  }
  if (err instanceof YouTubeError) {
    if (err.code === 'invalid_client' || err.code === 'unauthorized_client') {
      return new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Google did not accept the OAuth client. Check GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET on the api app.',
      })
    }
    if (err.code === 'invalid_grant') {
      return new TRPCError({ code: 'BAD_REQUEST', message: 'The Google sign-in expired or was already used. Connect again.' })
    }
    if (err.code === 'accessNotConfigured' || err.code === 'SERVICE_DISABLED') {
      return new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Enable the YouTube Data API v3 and the YouTube Analytics API in the OAuth client’s Google Cloud project.',
      })
    }
    return new TRPCError({ code: 'BAD_REQUEST', message: `Google rejected the connection (${err.code}): ${err.message}` })
  }
  if (err instanceof AppStoreError) {
    if (err.status === 401) {
      return new TRPCError({
        code: 'BAD_REQUEST',
        message:
          'App Store Connect did not accept this key. Check the Issuer ID, the Key ID and ' +
          'that the private key belongs to them.',
      })
    }
    if (err.status === 403) {
      return new TRPCError({
        code: 'BAD_REQUEST',
        message:
          'App Store Connect refused the request. Sales reports need a team key with the ' +
          'Sales and Reports, Finance or Admin role.',
      })
    }
    return new TRPCError({
      code: 'BAD_REQUEST',
      message: `App Store Connect rejected the request (${err.status}): ${err.message}`,
    })
  }
  if (err instanceof RevenueCatError) {
    if (err.status === 401) {
      return new TRPCError({
        code: 'BAD_REQUEST',
        message: 'RevenueCat did not accept this key. Use a v2 secret key from the project.',
      })
    }
    if (err.status === 403) {
      return new TRPCError({
        code: 'BAD_REQUEST',
        message:
          'RevenueCat refused the request. The key needs read access to project ' +
          'configuration and to charts and metrics.',
      })
    }
    return new TRPCError({
      code: 'BAD_REQUEST',
      message: `RevenueCat answered with an error (${err.status}). Try again in a minute.`,
    })
  }
  return new TRPCError({
    code: 'INTERNAL_SERVER_ERROR',
    message: 'Could not connect the source.',
    cause: err,
  })
}

/**
 * The dashboard's view of the API. Read procedures are thin wrappers around query definitions,
 * so tRPC, MCP and the Telegram agent can never drift apart.
 */
export const appRouter = t.router({
  apps: t.router({
    list: t.procedure.query(({ ctx }) => listApps.handler(ctx)),

    timeline: t.procedure.input(getAppTimeline.input).query(async ({ ctx, input }) => {
      const timeline = await getAppTimeline.handler(ctx, input)
      if (!timeline) throw new TRPCError({ code: 'NOT_FOUND', message: 'There is no such app.' })
      return timeline
    }),

    posts: t.procedure.input(listPosts.input).query(({ ctx, input }) => listPosts.handler(ctx, input)),

    /** Renames an app; its id and address stay the same. */
    rename: t.procedure
      .input(z.object({ appId: z.string().min(1).max(64), name: z.string().trim().min(1).max(80) }))
      .mutation(async ({ ctx, input }) => ({
        name: await renameApp(ctx.db, input.appId, input.name).catch((err: unknown) => {
          throw connectError(err)
        }),
      })),

    /**
     * Stops tracking an app: deletes it with its numbers and posts. What fed it stays, without an
     * app, on the Apps page.
     */
    remove: t.procedure.input(z.object({ appId: z.string().min(1).max(64) })).mutation(async ({ ctx, input }) => ({
      name: await removeApp(ctx.db, input.appId).catch((err: unknown) => {
        throw connectError(err)
      }),
    })),

    /** Makes an app by name, to link assets to; returns its id. */
    create: t.procedure
      .input(z.object({ name: z.string().trim().min(1).max(80) }))
      .mutation(async ({ ctx, input }) => ({
        appId: await createApp(ctx.db, input.name).catch((err: unknown) => {
          throw connectError(err)
        }),
      })),

    /**
     * Connects the project behind a RevenueCat secret key, to `appId` when it is added from an
     * app's settings, and starts fetching its history once it belongs to an app.
     */
    connectRevenueCat: t.procedure
      .input(z.object({ apiKey: z.string().trim().min(8).max(500), appId: z.string().min(1).max(64).optional() }))
      .mutation(async ({ ctx, input }) => {
        const connected = await connectRevenueCat(ctx, input.apiKey, { appId: input.appId }).catch((err: unknown) => {
          ctx.log.error(`connect RevenueCat failed: ${err instanceof Error ? err.message : err}`)
          throw connectError(err)
        })
        if (connected.length === 0) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'This key cannot see any RevenueCat project.',
          })
        }
        // A project waiting for an app is fetched once it is linked.
        const appIds = connected.flatMap((project) => (project.appId ? [project.appId] : []))
        if (appIds.length > 0) {
          startSync(ctx, { connectors, sources: [REVENUECAT], appIds, range: trailingRange(BACKFILL_DAYS) })
        }
        return { projects: connected }
      }),
  }),
  accounts: t.router({
    list: t.procedure.query(({ ctx }) => listAccounts.handler(ctx)),

    /**
     * Connects the App Store Connect account, adds its apps and starts fetching a year of
     * downloads. Also asks Apple to start analytics reports, when the key is allowed to.
     */
    connectAppStore: t.procedure
      .input(
        z.object({
          issuerId: z.string().trim().min(8).max(100),
          keyId: z.string().trim().min(4).max(40),
          vendorNumber: z.string().trim().regex(/^\d{4,15}$/, 'The vendor number is digits only'),
          privateKey: z.string().trim().min(100).max(5000),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const result = await connectAppStore(ctx, input).catch((err: unknown) => {
          ctx.log.error(`connect App Store failed: ${err instanceof Error ? err.message : err}`)
          throw connectError(err)
        })
        startSync(ctx, {
          connectors,
          sources: [APP_STORE],
          range: trailingRange(APP_STORE_HISTORY_DAYS),
        })
        return result
      }),
  }),
  /**
   * TikTok sign-in. The dashboard owns the browser side (the session, the state cookie and the
   * redirect); the API owns the client secret and the tokens.
   */
  tiktok: t.router({
    setup: t.procedure.query(() => ({ configured: tiktokConfig() !== null })),

    authorizeUrl: t.procedure
      .input(z.object({ redirectUri: z.url(), state: z.string().min(16).max(200) }))
      .query(({ input }) => {
        const config = tiktokConfig()
        if (!config) throw connectError(new TikTokNotConfiguredError())
        return { url: createTikTokClient({ config }).authorizeUrl(input) }
      }),

    /** Finishes the sign-in and starts reading the account's videos. */
    connect: t.procedure
      .input(
        z.object({
          code: z.string().min(1).max(2000),
          redirectUri: z.url(),
          appId: z.string().min(1).max(64),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const result = await connectTikTok(ctx, input).catch((err: unknown) => {
          ctx.log.error(`connect TikTok failed: ${err instanceof Error ? err.message : err}`)
          throw connectError(err)
        })
        startSync(ctx, {
          connectors,
          sources: [TIKTOK],
          appIds: [result.appId],
          range: trailingRange(7),
        })
        return result
      }),
  }),
  /**
   * The Google Play developer account: a service account key that can read the monthly report
   * files in the account's Cloud Storage bucket, and which app each package belongs to.
   */
  googlePlay: t.router({
    connect: t.procedure
      .input(
        z.object({
          serviceAccountJson: z.string().trim().min(100).max(10_000),
          storageUri: z.string().trim().min(3).max(500),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const result = await connectGooglePlay(ctx, input).catch((err: unknown) => {
          ctx.log.error(`connect Google Play failed: ${err instanceof Error ? err.message : err}`)
          throw connectError(err)
        })
        startSync(ctx, { connectors, sources: [GOOGLE_PLAY], range: trailingRange(GOOGLE_PLAY_HISTORY_DAYS) })
        return result
      }),
  }),
  /**
   * Facebook Pages and their linked Instagram accounts, through one Facebook sign-in. Like
   * TikTok, the dashboard owns the browser side and the API owns the app secret and tokens.
   */
  meta: t.router({
    setup: t.procedure.query(() => ({ configured: metaConfig() !== null })),

    authorizeUrl: t.procedure
      .input(z.object({ redirectUri: z.url(), state: z.string().min(16).max(200) }))
      .query(({ input }) => {
        const config = metaConfig()
        if (!config) throw connectError(new MetaNotConfiguredError())
        return { url: createMetaClient({ config }).authorizeUrl(input) }
      }),

    /** Finishes the sign-in and saves every Page and Instagram account it can see. */
    connect: t.procedure
      .input(z.object({ code: z.string().min(1).max(2000), redirectUri: z.url() }))
      .mutation(({ ctx, input }) =>
        connectMeta(ctx, input).catch((err: unknown) => {
          ctx.log.error(`connect Meta failed: ${err instanceof Error ? err.message : err}`)
          throw connectError(err)
        }),
      ),
  }),
  /**
   * What the accounts give access to, and which app each belongs to. Linking an asset fetches
   * its history; an app holds one iOS app, one Android app and one RevenueCat project.
   */
  assets: t.router({
    list: t.procedure.query(({ ctx }) => listAssets.handler(ctx)),

    /** Gives an asset to an app, to a new app (`'new'`), to the portfolio, or to none (`null`). */
    assign: t.procedure
      .input(z.object({ assetId: z.uuid(), appId: z.string().min(1).max(64).nullable() }))
      .mutation(async ({ ctx, input }) => {
        const { asset, appId } = await assignAsset(ctx.db, input).catch((err: unknown) => {
          throw connectError(err)
        })
        if (appId !== null && isAssetKind(asset.kind)) {
          const kind = ASSET_KINDS[asset.kind]
          startSync(ctx, {
            connectors,
            sources: [kind.provider],
            // The App Store and Google Play sync every app of the account at once.
            ...(kind.provider === 'app_store' || kind.provider === 'google_play' ? {} : { appIds: [appId] }),
            range: trailingRange(kind.backfillDays),
          })
        }
        return { appId }
      }),

    /** Stops assets asking for a decision (and unlinks them), or brings them back. */
    ignore: t.procedure
      .input(z.object({ assetIds: z.array(z.uuid()).min(1).max(500), ignored: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        const count = await setIgnored(ctx.db, input.assetIds, input.ignored).catch((err: unknown) => {
          throw connectError(err)
        })
        return { count }
      }),
  }),
  overview: t.router({
    get: t.procedure
      .input(getOverview.input)
      .query(({ ctx, input }) => getOverview.handler(ctx, input)),
  }),
  /** The Social, Store and Monetisation pages: one app or all of them, over a range. */
  performance: t.router({
    social: t.procedure
      .input(getSocialPerformance.input)
      .query(({ ctx, input }) => getSocialPerformance.handler(ctx, input)),
    store: t.procedure
      .input(getStorePerformance.input)
      .query(({ ctx, input }) => getStorePerformance.handler(ctx, input)),
    monetisation: t.procedure
      .input(getMonetisationPerformance.input)
      .query(({ ctx, input }) => getMonetisationPerformance.handler(ctx, input)),
    search: t.procedure
      .input(getSearchPerformance.input)
      .query(({ ctx, input }) => getSearchPerformance.handler(ctx, input)),
  }),
  /**
   * YouTube channels, through a Google sign-in. Like Meta, the dashboard owns the browser side
   * and the API owns the client secret and the tokens; channels wait for an app on the Apps page.
   */
  youtube: t.router({
    setup: t.procedure.query(() => ({ configured: youtubeConfig() !== null })),

    authorizeUrl: t.procedure
      .input(z.object({ redirectUri: z.url(), state: z.string().min(16).max(200) }))
      .query(({ input }) => {
        const config = youtubeConfig()
        if (!config) throw connectError(new YouTubeNotConfiguredError())
        return { url: createYouTubeClient({ config }).authorizeUrl(input) }
      }),

    /** Finishes the sign-in and saves the channel, waiting for an app. */
    connect: t.procedure
      .input(z.object({ code: z.string().min(1).max(2000), redirectUri: z.url() }))
      .mutation(({ ctx, input }) =>
        connectYouTube(ctx, input).catch((err: unknown) => {
          ctx.log.error(`connect YouTube failed: ${err instanceof Error ? err.message : err}`)
          throw connectError(err)
        }),
      ),
  }),
  /**
   * Google Search Console, through a service account added to the person's properties: the
   * Google Play one, or another key.
   */
  searchConsole: t.router({
    connect: t.procedure
      .input(
        z
          .object({ serviceAccountJson: z.string().trim().min(100).max(10_000).optional(), usePlayKey: z.boolean().optional() })
          .refine((value) => value.serviceAccountJson || value.usePlayKey, 'Give a key, or use the Google Play one'),
      )
      .mutation(async ({ ctx, input }) => {
        const result = await connectSearchConsole(ctx, input).catch((err: unknown) => {
          ctx.log.error(`connect Search Console failed: ${err instanceof Error ? err.message : err}`)
          throw connectError(err)
        })
        startSync(ctx, { connectors, sources: [SEARCH_CONSOLE], range: trailingRange(SEARCH_CONSOLE_HISTORY_DAYS) })
        return result
      }),

    /** The top queries or pages over a range, read live from Search Console. */
    top: t.procedure
      .input(
        z.object({
          appId: z.string().min(1).max(64).optional(),
          from: z.iso.date(),
          to: z.iso.date(),
          dimension: z.enum(['query', 'page']),
          limit: z.number().int().min(1).max(100).default(20),
        }),
      )
      .query(({ ctx, input }) =>
        searchTop(ctx, input).catch((err: unknown) => {
          if (err instanceof SearchConsoleError) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: `Search Console answered: ${err.message}` })
          }
          throw err
        }),
      ),
  }),
  /** The reviews inbox: written App Store and Google Play reviews, read state kept here. */
  reviews: t.router({
    list: t.procedure.input(listReviews.input).query(({ ctx, input }) => listReviews.handler(ctx, input)),

    summary: t.procedure.input(getReviewSummary.input).query(({ ctx, input }) => getReviewSummary.handler(ctx, input)),

    /** How many reviews wait in the inbox, for the sidebar. */
    unreadCount: t.procedure.query(async ({ ctx }) => {
      const [row] = await ctx.db.select({ count: count() }).from(reviewsTable).where(isNull(reviewsTable.readAt))
      return { count: row?.count ?? 0 }
    }),

    /** Marks the given reviews, or every review matching the filters, read or unread. */
    mark: t.procedure
      .input(
        z.object({
          ids: z.array(z.uuid()).min(1).max(500).optional(),
          filters: z.object(reviewFilters).optional(),
          read: z.boolean(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        if (!input.ids && !input.filters) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Say which reviews: ids or filters.' })
        }
        const changed = await markReviews(ctx.db, input.filters ? reviewConditions(input.filters) : undefined, input.read, input.ids)
        return { changed }
      }),
  }),
  sync: t.router({
    status: t.procedure.query(({ ctx }) => getSyncStatus.handler(ctx)),

    /** Starts a sync of every connected source and returns at once; see `status` for progress. */
    run: t.procedure
      .input(z.object({ days: z.number().int().min(1).max(400).default(7) }))
      .mutation(({ ctx, input }) => {
        startSync(ctx, { connectors, range: trailingRange(input.days) })
        return { started: true }
      }),
  }),
  // Velocity has no shell, so the generated demo data is loaded and removed through the API.
  // Both only ever touch apps whose id starts with `demo-`.
  demo: t.router({
    seed: t.procedure
      .input(z.object({ days: z.number().int().min(1).max(400).default(200) }))
      .mutation(({ ctx, input }) => seedDemo(ctx.db, { days: input.days })),
    clear: t.procedure.mutation(({ ctx }) => clearDemo(ctx.db)),
  }),
})

/** Imported type-only by `apps/web`; it is erased at build time, so the apps build separately. */
export type AppRouter = typeof appRouter
