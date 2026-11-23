import { fastifyTRPCPlugin, type FastifyTRPCPluginOptions } from '@trpc/server/adapters/fastify'
import Fastify from 'fastify'
import { requireBearerToken } from './auth/bearer.js'
import type { Db, Sql } from './db/client.js'
import { CopyRefusedError, copyDatabase } from './db/copy.js'
import type { Secrets } from './lib/crypto.js'
import { appRouter, type AppRouter } from './trpc/router.js'

export interface AppDeps {
  db: Db
  sql: Sql
  secrets: Secrets
  /** Resolves when the database answers; used by /health. */
  pingDb: () => Promise<unknown>
  internalApiToken: string
  /** The old database to copy from when moving to a new Velocity app; see db/copy.ts. */
  sourceDatabaseUrl?: string
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
        createContext: () => ({ db: deps.db, sql: deps.sql, secrets: deps.secrets, log: app.log }),
        onError({ path, error }) {
          app.log.error({ path, code: error.code }, error.message)
        },
      } satisfies FastifyTRPCPluginOptions<AppRouter>['trpcOptions'],
    })

    // Moves the data of an old copy of the API into this one, once; it refuses to write over data.
    internal.post('/internal/copy-database', async (_request, reply) => {
      if (!deps.sourceDatabaseUrl) {
        return reply.code(404).send({ ok: false, message: 'SOURCE_DATABASE_URL is not set on this API.' })
      }
      try {
        const result = await copyDatabase(deps.sql, deps.sourceDatabaseUrl, deps.secrets)
        app.log.info({ tables: result.tables }, 'copied the source database')
        return { ok: true, ...result }
      } catch (err) {
        if (err instanceof CopyRefusedError) return reply.code(409).send({ ok: false, message: err.message })
        throw err
      }
    })
  })

  return app
}
