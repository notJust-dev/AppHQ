import { fastifyTRPCPlugin, type FastifyTRPCPluginOptions } from '@trpc/server/adapters/fastify'
import Fastify from 'fastify'
import type { Accounts } from './auth/accounts.js'
import type { Auth } from './auth/auth.js'
import { requireBearerToken } from './auth/bearer.js'
import { authRoutes } from './auth/routes.js'
import type { Db, Sql } from './db/client.js'
import type { Secrets } from './lib/crypto.js'
import { reportError } from './lib/errors.js'
import { dashboardOrganization } from './organizations/dashboard.js'
import { ACCESS_HEADER, DASHBOARD_ACCESS, type ApiContext } from './trpc/init.js'
import { appRouter, type AppRouter } from './trpc/router.js'

export interface AppDeps {
  db: Db
  sql: Sql
  secrets: Secrets
  /** Resolves when the database answers; used by /health. */
  pingDb: () => Promise<unknown>
  internalApiToken: string
  /**
   * Whether the web app's statement that the visitor signed in with the dashboard password counts
   * (`ALLOW_DASHBOARD_PASSWORD`). Required, so no caller gets the password by default.
   */
  allowDashboardPassword: boolean
  /** Which organization the dashboard password works in; read from the database by default. */
  dashboardOrganization?: () => Promise<string>
  /** Accounts, when they are set up; without them /api/auth does not exist. */
  accounts?: { auth: Auth; origin: string; accounts: Accounts; paths: ReadonlySet<string> } | null
  logLevel?: 'info' | 'silent'
}

export async function buildApp(deps: AppDeps) {
  const app = Fastify({
    logger: { level: deps.logLevel ?? 'info' },
    // tRPC batches several procedure names into one path segment.
    routerOptions: { maxParamLength: 5000 },
  })

  // Server errors go to error reporting, when it is on; refusals and bad requests do not.
  app.addHook('onError', async (request, _reply, error) => {
    if ((error.statusCode ?? 500) >= 500) reportError(error, { route: request.routeOptions.url ?? 'unknown' })
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

  // Everything else is for the dashboard server only.
  await app.register(async (internal) => {
    internal.addHook('onRequest', requireBearerToken(deps.internalApiToken))

    if (deps.accounts) await internal.register(authRoutes(deps.accounts.auth, deps.accounts.origin, deps.accounts.paths))

    const accounts = deps.accounts?.accounts ?? null
    const organizationOfDashboard = deps.dashboardOrganization ?? dashboardOrganization(deps.db)
    let warnedOfPassword = false
    await internal.register(fastifyTRPCPlugin, {
      prefix: '/trpc',
      trpcOptions: {
        router: appRouter,
        createContext: ({ req }): ApiContext => {
          const cookie = req.headers.cookie
          const statesPassword = req.headers[ACCESS_HEADER] === DASHBOARD_ACCESS
          if (statesPassword && !deps.allowDashboardPassword && !warnedOfPassword) {
            warnedOfPassword = true
            app.log.warn('the web app sent a dashboard password session, but ALLOW_DASHBOARD_PASSWORD is false: refused. Unset DASHBOARD_PASSWORD on the web app.')
          }
          let session: ReturnType<ApiContext['session']> | undefined
          const sessionOnce = () => (session ??= accounts ? accounts.sessionFor(cookie) : Promise.resolve(null))
          return {
            db: deps.db,
            sql: deps.sql,
            secrets: deps.secrets,
            log: app.log,
            passwordAccess: statesPassword && deps.allowDashboardPassword,
            accounts,
            cookie,
            session: sessionOnce,
            account: () => sessionOnce().then((found) => found?.user ?? null),
            dashboardOrganization: organizationOfDashboard,
          }
        },
        onError({ path, error }) {
          // Refusals are expected; they say nothing about the API's health.
          if (error.code === 'UNAUTHORIZED' || error.code === 'FORBIDDEN') return
          app.log.error({ path, code: error.code }, error.message)
          if (error.code === 'INTERNAL_SERVER_ERROR') reportError(error.cause ?? error, { trpc: path ?? 'unknown' })
        },
      } satisfies FastifyTRPCPluginOptions<AppRouter>['trpcOptions'],
    })
  })

  return app
}
