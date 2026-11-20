import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import type { Db, Sql } from './client.js'

// Resolved from this file so it works from both src/ (tsx) and dist/ (node), whatever the cwd.
const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url))

/** Arbitrary but fixed: the advisory lock that makes concurrent migrators take turns. */
const MIGRATION_LOCK_ID = 727_002

/**
 * Applies pending migrations. Velocity has no SSH, so the API does this itself when it boots.
 * Two processes can start at once (the server and a cron command, or two test files), and the
 * migrator is not safe to run concurrently, so they queue on a lock.
 */
export async function runMigrations({ db, sql }: { db: Db; sql: Sql }): Promise<void> {
  // Advisory locks belong to a session, so the lock and unlock must use the same connection.
  const reserved = await sql.reserve()
  try {
    await reserved`select pg_advisory_lock(${MIGRATION_LOCK_ID})`
    try {
      await migrate(db, { migrationsFolder })
    } finally {
      await reserved`select pg_advisory_unlock(${MIGRATION_LOCK_ID})`
    }
  } finally {
    reserved.release()
  }
}
