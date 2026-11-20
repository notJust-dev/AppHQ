import { initTRPC } from '@trpc/server'
import type { QueryContext } from '../queries/define.js'
import { getOverview } from '../queries/get-overview.js'
import { getSyncStatus } from '../queries/get-sync-status.js'
import { listApps } from '../queries/list-apps.js'

const t = initTRPC.context<QueryContext>().create()

/**
 * The dashboard's view of the query layer. Every procedure is a thin wrapper around a query
 * definition, so tRPC, MCP and the Telegram agent can never drift apart.
 */
export const appRouter = t.router({
  apps: t.router({
    list: t.procedure.query(({ ctx }) => listApps.handler(ctx)),
  }),
  overview: t.router({
    get: t.procedure
      .input(getOverview.input)
      .query(({ ctx, input }) => getOverview.handler(ctx, input)),
  }),
  sync: t.router({
    status: t.procedure.query(({ ctx }) => getSyncStatus.handler(ctx)),
  }),
})

/** Imported type-only by `apps/web`; it is erased at build time, so the apps build separately. */
export type AppRouter = typeof appRouter
