import { buildApp } from './app.js'
import { connectors } from './connectors/registry.js'
import { createDb } from './db/client.js'
import { runMigrations } from './db/migrate.js'
import { loadEnv } from './env.js'
import { createSecrets } from './lib/crypto.js'
import { startSyncSchedule } from './sync/schedule.js'

const env = loadEnv()
const { db, sql } = createDb(env.DATABASE_URL)

await runMigrations({ db, sql })

const secrets = createSecrets(env.ENCRYPTION_KEY)
const app = await buildApp({
  db,
  sql,
  secrets,
  pingDb: () => sql`select 1`,
  internalApiToken: env.INTERNAL_API_TOKEN,
})

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
