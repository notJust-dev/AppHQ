import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import type { Db } from './client.js'

// Resolved from this file so it works from both src/ (tsx) and dist/ (node), whatever the cwd.
const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url))

/** Velocity has no SSH, so the API applies pending migrations itself when it boots. */
export async function runMigrations(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder })
}
