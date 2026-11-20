import { fastifyTRPCPlugin, type FastifyTRPCPluginOptions } from '@trpc/server/adapters/fastify'
import Fastify from 'fastify'
import { requireBearerToken } from './auth/bearer.js'
import type { Db } from './db/client.js'
import { appRouter, type AppRouter } from './trpc/router.js'

export interface AppDeps {
  db: Db
  /** Resolves when the database answers; used by /health. */
  pingDb: () => Promise<unknown>
  internalApiToken: string
  logLevel?: 'info' | 'silent'
}

export async function buildApp(deps: AppDeps) {
  const app = Fastify({
    logger: { level: deps.logLevel ?? 'info' },
    // tRPC batches several procedure names into one path segment.
    routerOptions: { maxParamLength: 5000 },
  })

  // Public and unauthenticated: Velocity, uptime checks and the deploy smoke test use it.
  app.get('/health', async (_request, reply) => {
    try {
      await deps.pingDb()
      return { ok: true, db: 'up' }
    } catch {
      return reply.code(503).send({ ok: false, db: 'down' })
    }
  })

  // Everything under /trpc is for the dashboard server only.
  await app.register(async (internal) => {
    internal.addHook('onRequest', requireBearerToken(deps.internalApiToken))
    await internal.register(fastifyTRPCPlugin, {
      prefix: '/trpc',
      trpcOptions: {
        router: appRouter,
        createContext: () => ({ db: deps.db }),
        onError({ path, error }) {
          app.log.error({ path, code: error.code }, error.message)
        },
      } satisfies FastifyTRPCPluginOptions<AppRouter>['trpcOptions'],
    })
  })

  return app
}
