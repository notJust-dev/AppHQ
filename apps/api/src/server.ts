import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { buildApp } from './app.js'
import { createAccounts } from './auth/accounts.js'
import { authConfigFromEnv, authOptions, createAuth } from './auth/auth.js'
import { connectors } from './connectors/registry.js'
import { createDb } from './db/client.js'
import { account, invitation, member, organization, session, user, verification } from './db/schema.js'
import { runMigrations } from './db/migrate.js'
import { loadEnv } from './env.js'
import { createSecrets } from './lib/crypto.js'
import { assertRowLevelSecurity } from './organizations/tenancy.js'
import { startSyncSchedule } from './sync/schedule.js'

const env = loadEnv()
const { db, sql } = createDb(env.DATABASE_URL)

await runMigrations({ db, sql })

// Before anything is served or synced: if row-level security does not hold the organization
// tables to the organization of each unit of work, the API does not start (and says why).
const { role } = await assertRowLevelSecurity(db)

const secrets = createSecrets(env.ENCRYPTION_KEY)

// Accounts are optional: without their variables /api/auth does not exist, as before.
const authConfig = authConfigFromEnv(env)
const auth = authConfig
  ? createAuth(
      authOptions(
        authConfig,
        drizzleAdapter(db, {
          provider: 'pg',
          schema: { user, session, account, verification, organization, member, invitation },
        }),
      ),
    )
  : null

const app = await buildApp({
  db,
  sql,
  secrets,
  pingDb: () => sql`select 1`,
  internalApiToken: env.INTERNAL_API_TOKEN,
  accounts: auth && authConfig ? { auth, origin: authConfig.url, accounts: createAccounts(auth, authConfig) } : null,
})
app.log.info(authConfig ? `accounts are on, signing in at ${authConfig.url}` : 'accounts are off')
app.log.info(role ? `organization data: row-level security, as the role ${role}` : 'organization data: row-level security, as the tables\' owner (no role can be made here)')

// The API keeps the data fresh itself; see sync/schedule.ts for why not a Velocity cron entry.
const stopSchedule =
  env.SYNC_EVERY_HOURS > 0
    ? startSyncSchedule({ db, sql, secrets, log: app.log }, { connectors, intervalHours: env.SYNC_EVERY_HOURS })
    : () => {}

// The process manager sends SIGTERM on every deploy and restart.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, async () => {
    app.log.info(`${signal} received, shutting down`)
    stopSchedule()
    await app.close()
    await sql.end({ timeout: 5 })
    process.exit(0)
  })
}

await app.listen({ host: env.HOST, port: env.PORT })
