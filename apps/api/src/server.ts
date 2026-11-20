import { buildApp } from './app.js'
import { createDb } from './db/client.js'
import { runMigrations } from './db/migrate.js'
import { loadEnv } from './env.js'
import { createSecrets } from './lib/crypto.js'

const env = loadEnv()
const { db, sql } = createDb(env.DATABASE_URL)

await runMigrations(db)

const app = await buildApp({
  db,
  sql,
  secrets: createSecrets(env.ENCRYPTION_KEY),
  pingDb: () => sql`select 1`,
  internalApiToken: env.INTERNAL_API_TOKEN,
})

// The process manager sends SIGTERM on every deploy and restart.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, async () => {
    app.log.info(`${signal} received, shutting down`)
    await app.close()
    await sql.end({ timeout: 5 })
    process.exit(0)
  })
}

await app.listen({ host: env.HOST, port: env.PORT })
