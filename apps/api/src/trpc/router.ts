import { TRPCError, initTRPC } from '@trpc/server'
import { z } from 'zod'
import { connectors } from '../connectors/registry.js'
import { RevenueCatError } from '../connectors/revenuecat/client.js'
import { REVENUECAT } from '../connectors/revenuecat/connector.js'
import type { Sql } from '../db/client.js'
import { MissingEncryptionKeyError, type Secrets } from '../lib/crypto.js'
import { trailingRange } from '../lib/dates.js'
import type { Logger } from '../lib/logger.js'
import type { QueryContext } from '../queries/define.js'
import { getOverview } from '../queries/get-overview.js'
import { getSyncStatus } from '../queries/get-sync-status.js'
import { listApps } from '../queries/list-apps.js'
import { clearDemo, seedDemo } from '../seed/demo.js'
import { connectRevenueCat } from '../services/connect-revenuecat.js'
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

/** Turns a failure to connect RevenueCat into a message that is safe and useful to show. */
function connectError(err: unknown): TRPCError {
  if (err instanceof MissingEncryptionKeyError) {
    return new TRPCError({ code: 'PRECONDITION_FAILED', message: err.message })
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
    message: 'Could not connect RevenueCat.',
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
