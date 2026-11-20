import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema.js'

/** Connects with the given URL, or with the PG* environment variables when there is none. */
export function createDb(url?: string) {
  const options = {
    max: 10,
    // Migrations emit "already exists" notices on every boot; they are not useful in logs.
    onnotice: () => {},
  }
  const sql = url ? postgres(url, options) : postgres(options)
  const db = drizzle(sql, { schema })
  return { sql, db }
}

export type Sql = ReturnType<typeof createDb>['sql']
export type Db = ReturnType<typeof createDb>['db']
