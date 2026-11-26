import { TRPCError } from '@trpc/server'
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
import { MissingEncryptionKeyError } from '../lib/crypto.js'
import { trailingRange } from '../lib/dates.js'
import { getAppFlow } from '../queries/get-app-flow.js'
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
import { and, count, eq, isNull } from 'drizzle-orm'
import { organization as organizationTable, reviews as reviewsTable } from '../db/schema.js'
import { clearDemo, seedDemo } from '../seed/demo.js'
import { ConnectInputError, connectAppStore } from '../services/connect-app-store.js'
import { connectRevenueCat } from '../services/connect-revenuecat.js'
import {
  GOOGLE_PLAY,
  GOOGLE_PLAY_HISTORY_DAYS,
} from '../connectors/google-play/connector.js'
import { connectGooglePlay } from '../services/connect-google-play.js'
import { connectMeta } from '../services/connect-meta.js'
import { ASSET_KINDS, PORTFOLIO, isAssetKind } from '../assets/kinds.js'
import { assignAsset, createApp, removeApp, renameApp, setIgnored } from '../assets/store.js'
import { connectTikTok } from '../services/connect-tiktok.js'
import { startSync } from '../sync/background.js'
import { answerWaitlist, answerWaitlistInput, joinWaitlist, joinWaitlistInput } from '../waitlist/join.js'
import type { AccountUser } from '../auth/accounts.js'
import { openProcedure, procedure, router, signedInAccount, type ApiContext } from './init.js'

export type { ApiContext } from './init.js'

/** How much history to fetch when an app is first connected. */
const BACKFILL_DAYS = 400

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
 * A sign-in that connects a source starts in one organization and must finish in it. The
 * dashboard keeps the organization from `authorizeUrl` in its sign-in cookie and hands it back.
 */
const startedIn = z.uuid()
function finishesWhereItStarted(ctx: { organizationId: string }, organizationId: string) {
  if (organizationId !== ctx.organizationId) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'This sign-in was started in another organization. Start it again here.',
    })
  }
}

/**
 * Approved accounts get an organization of their own the first time the API sees them approved
 * (approval is a database update, so there is no code at that moment), unless they already
 * belong to one. Accounts that only asked get none. Dashboard procedures never make one: an
 * approved account without a membership is refused there until this has run.
 */
async function organizationIfApproved(ctx: ApiContext, account: AccountUser) {
  if (account.accessStatus !== 'approved' || !ctx.accounts) return
  const { created } = await ctx.accounts.ensureOrganization(account.id)
  if (created) ctx.log.info('accounts: made an organization for an approved account')
}

/** What an account may see of itself. */
function profile(account: AccountUser) {
  return {
    email: account.email,
    name: account.name,
    accessStatus: account.accessStatus,
    accessRequestedAt: account.accessRequestedAt?.toISOString() ?? null,
  }
}

/**
 * The dashboard's view of the API. Read procedures are thin wrappers around query definitions,
 * so tRPC, MCP and the Telegram agent can never drift apart.
 *
 * Every procedure is for the dashboard (the dashboard password, or an approved member account, in
 * one organization) unless its `meta` says otherwise; see `trpc/init.ts`, and the list in
 * `access.test.ts`, which has to name each one.
 */
export const appRouter = router({
  apps: router({
    list: procedure.query(({ ctx }) => listApps.handler(ctx)),

    timeline: procedure.input(getAppTimeline.input).query(async ({ ctx, input }) => {
      const timeline = await getAppTimeline.handler(ctx, input)
      if (!timeline) throw new TRPCError({ code: 'NOT_FOUND', message: 'There is no such app.' })
      return timeline
    }),

    /** Totals for the funnel and flow charts: views, downloads, trials and what became of them. */
    flow: procedure.input(getAppFlow.input).query(async ({ ctx, input }) => {
      const flow = await getAppFlow.handler(ctx, input)
      if (!flow) throw new TRPCError({ code: 'NOT_FOUND', message: 'There is no such app.' })
      return flow
    }),

    posts: procedure.input(listPosts.input).query(({ ctx, input }) => listPosts.handler(ctx, input)),

    /** Renames an app; its id and address stay the same. */
    rename: procedure
      .input(z.object({ appId: z.uuid(), name: z.string().trim().min(1).max(80) }))
      .mutation(async ({ ctx, input }) => ({
        name: await renameApp(ctx, input.appId, input.name).catch((err: unknown) => {
          throw connectError(err)
        }),
      })),

    /**
     * Stops tracking an app: deletes it with its numbers and posts. What fed it stays, without an
     * app, on the Apps page.
     */
    remove: procedure.input(z.object({ appId: z.uuid() })).mutation(async ({ ctx, input }) => ({
      name: await removeApp(ctx, input.appId).catch((err: unknown) => {
        throw connectError(err)
      }),
    })),

    /** Makes an app by name, to link assets to; returns its id. */
    create: procedure
      .input(z.object({ name: z.string().trim().min(1).max(80) }))
      .mutation(async ({ ctx, input }) => ({
        appId: await createApp(ctx, input.name).catch((err: unknown) => {
          throw connectError(err)
        }),
      })),

    /**
     * Connects the project behind a RevenueCat secret key, to `appId` when it is added from an
     * app's settings, and starts fetching its history once it belongs to an app.
     */
    connectRevenueCat: procedure
      .input(z.object({ apiKey: z.string().trim().min(8).max(500), appId: z.uuid().optional() }))
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
          startSync(ctx.background, { organizationId: ctx.organizationId, connectors, sources: [REVENUECAT], appIds, range: trailingRange(BACKFILL_DAYS) })
        }
        return { projects: connected }
      }),
  }),
  accounts: router({
    list: procedure.query(({ ctx }) => listAccounts.handler(ctx)),

    /**
     * Connects the App Store Connect account, adds its apps and starts fetching a year of
     * downloads. Also asks Apple to start analytics reports, when the key is allowed to.
     */
    connectAppStore: procedure
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
        startSync(ctx.background, {
          organizationId: ctx.organizationId,
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
  tiktok: router({
    setup: procedure.query(() => ({ configured: tiktokConfig() !== null })),

    authorizeUrl: procedure
      .input(z.object({ redirectUri: z.url(), state: z.string().min(16).max(200) }))
      .query(({ ctx, input }) => {
        const config = tiktokConfig()
        if (!config) throw connectError(new TikTokNotConfiguredError())
        return { url: createTikTokClient({ config }).authorizeUrl(input), organizationId: ctx.organizationId }
      }),

    /** Finishes the sign-in and starts reading the account's videos. */
    connect: procedure
      .input(
        z.object({
          code: z.string().min(1).max(2000),
          redirectUri: z.url(),
          appId: z.uuid(),
          organizationId: startedIn,
        }),
      )
      .mutation(async ({ ctx, input }) => {
        finishesWhereItStarted(ctx, input.organizationId)
        const result = await connectTikTok(ctx, input).catch((err: unknown) => {
          ctx.log.error(`connect TikTok failed: ${err instanceof Error ? err.message : err}`)
          throw connectError(err)
        })
        startSync(ctx.background, {
          organizationId: ctx.organizationId,
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
  googlePlay: router({
    connect: procedure
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
        startSync(ctx.background, { organizationId: ctx.organizationId, connectors, sources: [GOOGLE_PLAY], range: trailingRange(GOOGLE_PLAY_HISTORY_DAYS) })
        return result
      }),
  }),
  /**
   * Facebook Pages and their linked Instagram accounts, through one Facebook sign-in. Like
   * TikTok, the dashboard owns the browser side and the API owns the app secret and tokens.
   */
  meta: router({
    setup: procedure.query(() => ({ configured: metaConfig() !== null })),

    authorizeUrl: procedure
      .input(z.object({ redirectUri: z.url(), state: z.string().min(16).max(200) }))
      .query(({ ctx, input }) => {
        const config = metaConfig()
        if (!config) throw connectError(new MetaNotConfiguredError())
        return { url: createMetaClient({ config }).authorizeUrl(input), organizationId: ctx.organizationId }
      }),

    /** Finishes the sign-in and saves every Page and Instagram account it can see. */
    connect: procedure
      .input(z.object({ code: z.string().min(1).max(2000), redirectUri: z.url(), organizationId: startedIn }))
      .mutation(({ ctx, input }) => {
        finishesWhereItStarted(ctx, input.organizationId)
        return connectMeta(ctx, input).catch((err: unknown) => {
          ctx.log.error(`connect Meta failed: ${err instanceof Error ? err.message : err}`)
          throw connectError(err)
        })
      }),
  }),
  /**
   * What the accounts give access to, and which app each belongs to. Linking an asset fetches
   * its history; an app holds one iOS app, one Android app and one RevenueCat project.
   */
  assets: router({
    list: procedure.query(({ ctx }) => listAssets.handler(ctx)),

    /** Gives an asset to an app, to a new app (`'new'`), to the portfolio (`'portfolio'`), or to none (`null`). */
    assign: procedure
      .input(z.object({ assetId: z.uuid(), appId: z.union([z.uuid(), z.literal('new'), z.literal(PORTFOLIO)]).nullable() }))
      .mutation(async ({ ctx, input }) => {
        const { asset, appId } = await assignAsset(ctx, input).catch((err: unknown) => {
          throw connectError(err)
        })
        if (appId !== null && isAssetKind(asset.kind)) {
          const kind = ASSET_KINDS[asset.kind]
          startSync(ctx.background, {
            organizationId: ctx.organizationId,
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
    ignore: procedure
      .input(z.object({ assetIds: z.array(z.uuid()).min(1).max(500), ignored: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        const count = await setIgnored(ctx, input.assetIds, input.ignored).catch((err: unknown) => {
          throw connectError(err)
        })
        return { count }
      }),
  }),
  overview: router({
    get: procedure
      .input(getOverview.input)
      .query(({ ctx, input }) => getOverview.handler(ctx, input)),
  }),
  /** The Social, Store and Monetisation pages: one app or all of them, over a range. */
  performance: router({
    social: procedure
      .input(getSocialPerformance.input)
      .query(({ ctx, input }) => getSocialPerformance.handler(ctx, input)),
    store: procedure
      .input(getStorePerformance.input)
      .query(({ ctx, input }) => getStorePerformance.handler(ctx, input)),
    monetisation: procedure
      .input(getMonetisationPerformance.input)
      .query(({ ctx, input }) => getMonetisationPerformance.handler(ctx, input)),
    search: procedure
      .input(getSearchPerformance.input)
      .query(({ ctx, input }) => getSearchPerformance.handler(ctx, input)),
  }),
  /**
   * YouTube channels, through a Google sign-in. Like Meta, the dashboard owns the browser side
   * and the API owns the client secret and the tokens; channels wait for an app on the Apps page.
   */
  youtube: router({
    setup: procedure.query(() => ({ configured: youtubeConfig() !== null })),

    authorizeUrl: procedure
      .input(z.object({ redirectUri: z.url(), state: z.string().min(16).max(200) }))
      .query(({ ctx, input }) => {
        const config = youtubeConfig()
        if (!config) throw connectError(new YouTubeNotConfiguredError())
        return { url: createYouTubeClient({ config }).authorizeUrl(input), organizationId: ctx.organizationId }
      }),

    /** Finishes the sign-in and saves the channel, waiting for an app. */
    connect: procedure
      .input(z.object({ code: z.string().min(1).max(2000), redirectUri: z.url(), organizationId: startedIn }))
      .mutation(({ ctx, input }) => {
        finishesWhereItStarted(ctx, input.organizationId)
        return connectYouTube(ctx, input).catch((err: unknown) => {
          ctx.log.error(`connect YouTube failed: ${err instanceof Error ? err.message : err}`)
          throw connectError(err)
        })
      }),
  }),
  /**
   * Google Search Console, through a service account added to the person's properties: the
   * Google Play one, or another key.
   */
  searchConsole: router({
    connect: procedure
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
        startSync(ctx.background, { organizationId: ctx.organizationId, connectors, sources: [SEARCH_CONSOLE], range: trailingRange(SEARCH_CONSOLE_HISTORY_DAYS) })
        return result
      }),

    /** The top queries or pages over a range, read live from Search Console. */
    top: procedure
      .input(
        z.object({
          appId: z.uuid().optional(),
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
  reviews: router({
    list: procedure.input(listReviews.input).query(({ ctx, input }) => listReviews.handler(ctx, input)),

    summary: procedure.input(getReviewSummary.input).query(({ ctx, input }) => getReviewSummary.handler(ctx, input)),

    /** How many reviews wait in the inbox, for the sidebar. */
    unreadCount: procedure.query(async ({ ctx }) => {
      const [row] = await ctx.run((db) =>
        db
          .select({ count: count() })
          .from(reviewsTable)
          .where(and(eq(reviewsTable.organizationId, ctx.organizationId), isNull(reviewsTable.readAt))),
      )
      return { count: row?.count ?? 0 }
    }),

    /** Marks the given reviews, or every review matching the filters, read or unread. */
    mark: procedure
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
        const changed = await markReviews(
          ctx,
          input.filters ? reviewConditions(ctx.organizationId, input.filters) : undefined,
          input.read,
          input.ids,
        )
        return { changed }
      }),
  }),
  sync: router({
    status: procedure.query(({ ctx }) => getSyncStatus.handler(ctx)),

    /** Starts a sync of every connected source and returns at once; see `status` for progress. */
    run: procedure
      .input(z.object({ days: z.number().int().min(1).max(400).default(7) }))
      .mutation(({ ctx, input }) => {
        startSync(ctx.background, { organizationId: ctx.organizationId, connectors, range: trailingRange(input.days) })
        return { started: true }
      }),
  }),
  /** The landing page's waitlist form. Public: whoever is on the landing page can use it. */
  waitlist: router({
    /** Adds an address from the public landing page; a repeat sign-up is not an error. */
    join: openProcedure.meta({ access: 'public' }).input(joinWaitlistInput).mutation(async ({ ctx, input }) => {
      const { added, answerToken } = await joinWaitlist(ctx.db, input)
      if (added) ctx.log.info(`waitlist: new sign-up from ${input.source}`)
      return { answerToken }
    }),

    /** Saves the optional follow-up questions for the sign-up that received `answerToken`. */
    answer: openProcedure.meta({ access: 'public' }).input(answerWaitlistInput).mutation(async ({ ctx, input }) => {
      if (!(await answerWaitlist(ctx.db, input))) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'That sign-up has no questions waiting.' })
      }
      return { ok: true as const }
    }),
  }),
  /**
   * The visitor's own account, for the Request access page. An account sees only itself. Asking
   * grants nothing; approval is a database update (see the README).
   */
  account: router({
    /** How people can sign in here; empty when accounts are off. Public: the landing page asks. */
    config: openProcedure
      .meta({ access: 'public' })
      .query(({ ctx }) => ({ providers: ctx.accounts?.providers ?? [], email: ctx.accounts?.email ?? false })),

    get: openProcedure.meta({ access: 'account' }).query(async ({ ctx }) => {
      const account = await signedInAccount(ctx)
      await organizationIfApproved(ctx, account)
      return profile(account)
    }),

    /** Asks for access. Asking again changes nothing. */
    requestAccess: openProcedure.meta({ access: 'account' }).mutation(async ({ ctx }) => {
      const account = await signedInAccount(ctx)
      const updated = await ctx.accounts?.requestAccess(account.id)
      if (!updated) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Sign in first.' })
      if (account.accessStatus === null) ctx.log.info('accounts: new access request')
      await organizationIfApproved(ctx, updated)
      return profile(updated)
    }),
  }),
  /** The organization this request works in, as `inOrganization` chose it. */
  organization: router({
    current: procedure.query(async ({ ctx }) => {
      // The organization table has no row-level security and the tenant role can't read it, so
      // this reads it as the login, by the id the middleware chose, and nothing else.
      const [row] = await ctx.background.db
        .select({ name: organizationTable.name })
        .from(organizationTable)
        .where(eq(organizationTable.id, ctx.organizationId))
        .limit(1)
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'This organization no longer exists.' })
      return { name: row.name, via: ctx.via }
    }),
  }),
  // Velocity has no shell, so the generated demo data is loaded and removed through the API.
  // Both only ever touch apps marked as demo apps, in the context's organization.
  demo: router({
    seed: procedure
      .input(z.object({ days: z.number().int().min(1).max(400).default(200) }))
      .mutation(({ ctx, input }) => seedDemo(ctx, { days: input.days })),
    clear: procedure.mutation(({ ctx }) => clearDemo(ctx)),
  }),
})

/** Imported type-only by `apps/web`; it is erased at build time, so the apps build separately. */
export type AppRouter = typeof appRouter
