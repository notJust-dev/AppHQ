import { initTRPC } from '@trpc/server'
import { z } from 'zod'
import type { QueryContext } from '../queries/define.js'
import { getOverview } from '../queries/get-overview.js'
import { getSyncStatus } from '../queries/get-sync-status.js'
import { listApps } from '../queries/list-apps.js'
import { clearDemo, seedDemo } from '../seed/demo.js'

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
