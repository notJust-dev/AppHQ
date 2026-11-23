import { pipeline } from 'node:stream/promises'
import postgres from 'postgres'
import type { Secrets } from '../lib/crypto.js'
import type { Sql } from './client.js'

/** A table as it was copied, with its row count on each side. */
export interface CopiedTable {
  table: string
  source: number
  copied: number
}

export interface CopyResult {
  tables: CopiedTable[]
  /**
   * Whether this API's ENCRYPTION_KEY opens the stored credentials it copied: false means the
   * accounts would all have to be connected again. Null when nothing encrypted was copied.
   */
  credentialsReadable: boolean | null
}

/** The copy would write over data, or the two databases do not match; nothing was changed. */
export class CopyRefusedError extends Error {}

/** The row migration 0004 inserts for the accounts shared by several apps. */
const MIGRATION_ROW = { table: 'apps', id: 'portfolio' }

/**
 * Copies every table of another database of this API into this one, for moving the API to a
 * new Velocity app. Velocity's PostgreSQL belongs to one app and only takes connections from its
 * own server, so the new app reads the old app's database there instead of a dump being moved.
 *
 * Refuses unless both databases have run the same migrations and this one holds nothing but what
 * the migrations insert, so it never writes over real data. Reads the source in one snapshot and
 * writes in one transaction: either every table is copied, with the same row count, or none is.
 */
export async function copyDatabase(target: Sql, sourceUrl: string, secrets: Secrets): Promise<CopyResult> {
  const source = postgres(sourceUrl, { max: 1, onnotice: () => {} })
  try {
    const [sourceMigrations, targetMigrations] = await Promise.all([migrationsOf(source), migrationsOf(target)])
    if (sourceMigrations !== targetMigrations) {
      throw new CopyRefusedError('The two databases have not run the same migrations; deploy the same code to both first.')
    }

    const tables = await tablesInOrder(target)
    for (const table of tables) {
      const [row] = await (table === MIGRATION_ROW.table
        ? target<{ n: number }[]>`select count(*)::int as n from ${target(table)} where id <> ${MIGRATION_ROW.id}`
        : target<{ n: number }[]>`select count(*)::int as n from ${target(table)}`)
      if ((row?.n ?? 0) > 0) {
        throw new CopyRefusedError(`This database already has data in ${table}; the copy only goes into a new, empty one.`)
      }
    }

    const columns = new Map<string, string[]>()
    for (const table of tables) columns.set(table, await columnsOf(target, table))

    const copied = await target.begin(async (tx) => {
      // Clears what the migrations inserted, as the source has its own copy of those rows.
      await tx`truncate ${tx(tables)} restart identity cascade`
      return source.begin('isolation level repeatable read read only', async (snapshot) => {
        const result: CopiedTable[] = []
        // Parents before the tables that refer to them, so every reference already resolves.
        for (const table of tables) {
          const list = columns.get(table) ?? []
          const reading = await snapshot`copy ${snapshot(table)} (${snapshot(list)}) to stdout`.readable()
          const writing = await tx`copy ${tx(table)} (${tx(list)}) from stdin`.writable()
          await pipeline(reading, writing)
          const [from] = await snapshot<{ n: number }[]>`select count(*)::int as n from ${snapshot(table)}`
          const [to] = await tx<{ n: number }[]>`select count(*)::int as n from ${tx(table)}`
          const entry = { table, source: from?.n ?? 0, copied: to?.n ?? 0 }
          if (entry.source !== entry.copied) {
            throw new Error(`${table}: ${entry.source} rows in the source, ${entry.copied} copied`)
          }
          result.push(entry)
        }
        return result
      })
    })

    // Identity and serial columns carry on after the copied ids rather than reusing them.
    const counters = await target<{ table: string; column: string; sequence: string }[]>`
      select c.relname as table, a.attname as column,
        pg_get_serial_sequence(format('%I.%I', n.nspname, c.relname), a.attname) as sequence
      from pg_attribute a
      join pg_class c on c.oid = a.attrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
        and pg_get_serial_sequence(format('%I.%I', n.nspname, c.relname), a.attname) is not null`
    for (const { table, column, sequence } of counters) {
      await target`select setval(${sequence}, coalesce((select max(${target(column)}) from ${target(table)}), 0) + 1, false)`
    }

    return { tables: copied, credentialsReadable: await credentialsReadable(target, secrets) }
  } finally {
    await source.end({ timeout: 5 })
  }
}

const migrationsOf = async (sql: Sql) => {
  const rows = await sql<{ hash: string }[]>`select hash from drizzle.__drizzle_migrations order by id`
  return rows.map((row) => row.hash).join(',')
}

/** The columns to copy: every stored column, in the order the table defines them. */
const columnsOf = async (sql: Sql, table: string) => {
  const rows = await sql<{ name: string }[]>`
    select a.attname as name
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = ${table}
      and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
    order by a.attnum`
  return rows.map((row) => row.name)
}

/** The public tables, each after every table it refers to. */
async function tablesInOrder(sql: Sql): Promise<string[]> {
  const tables = await sql<{ name: string }[]>`
    select c.relname as name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
    order by c.relname`
  const references = await sql<{ child: string; parent: string }[]>`
    select child.relname as child, parent.relname as parent
    from pg_constraint k
    join pg_class child on child.oid = k.conrelid
    join pg_class parent on parent.oid = k.confrelid
    join pg_namespace n on n.oid = child.relnamespace
    where k.contype = 'f' and n.nspname = 'public' and child.oid <> parent.oid`

  const ordered: string[] = []
  const remaining = new Set(tables.map((table) => table.name))
  while (remaining.size > 0) {
    const ready = [...remaining].filter((table) =>
      references.every((ref) => ref.child !== table || !remaining.has(ref.parent)),
    )
    if (ready.length === 0) throw new Error(`The tables refer to each other in a loop: ${[...remaining].join(', ')}`)
    for (const table of ready) {
      ordered.push(table)
      remaining.delete(table)
    }
  }
  return ordered
}

async function credentialsReadable(sql: Sql, secrets: Secrets): Promise<boolean | null> {
  const [row] = await sql<{ value: string }[]>`
    select coalesce(access_token_enc, refresh_token_enc) as value
    from connections
    where access_token_enc is not null or refresh_token_enc is not null
    limit 1`
  if (!row) return null
  try {
    secrets.decrypt(row.value)
    return true
  } catch {
    return false
  }
}
