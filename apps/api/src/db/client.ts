import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema.js'

export function createDb(url: string) {
  const sql = postgres(url, {
    max: 10,
    // Migrations emit "already exists" notices on every boot; they are not useful in logs.
    onnotice: () => {},
  })
  const db = drizzle(sql, { schema })
  return { sql, db }
}

export type Sql = ReturnType<typeof createDb>['sql']
export type Db = ReturnType<typeof createDb>['db']
