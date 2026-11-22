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
import { assignAsset, createApp, setIgnored } from '../assets/store.js'
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
  if (err instanceof TikTokNotConfiguredError || err instanceof MetaNotConfiguredError) {
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

    /** Makes an app by name, to link assets to; returns its id. */
    create: t.procedure
      .input(z.object({ name: z.string().trim().min(1).max(80) }))
      .mutation(async ({ ctx, input }) => ({
        appId: await createApp(ctx.db, input.name).catch((err: unknown) => {
          throw connectError(err)
        }),
      })),

    /** Registers the app behind a RevenueCat secret key and starts fetching its history. */
    connectRevenueCat: t.procedure
      .input(z.object({ apiKey: z.string().trim().min(8).max(500) }))
      .mutation(async ({ ctx, input }) => {
        const connected = await connectRevenueCat(ctx, input.apiKey).catch((err: unknown) => {
          ctx.log.error(`connect RevenueCat failed: ${err instanceof Error ? err.message : err}`)
          throw connectError(err)
        })
        if (connected.length === 0) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'This key cannot see any RevenueCat project.',
          })
        }
        startSync(ctx, {
          connectors,
          sources: [REVENUECAT],
          appIds: connected.map((app) => app.appId),
          range: trailingRange(BACKFILL_DAYS),
        })
        return { apps: connected }
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

    /** Stops an asset asking for a decision (and unlinks it), or brings it back. */
    ignore: t.procedure
      .input(z.object({ assetId: z.uuid(), ignored: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        await setIgnored(ctx.db, input.assetId, input.ignored).catch((err: unknown) => {
          throw connectError(err)
        })
        return { ok: true }
      }),
  }),
  overview: t.router({
    get: t.procedure
      .input(getOverview.input)
      .query(({ ctx, input }) => getOverview.handler(ctx, input)),
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
