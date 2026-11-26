import { AsyncLocalStorage } from 'node:async_hooks'
import { sql } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { tenancyOf } from './tenancy.js'

/** The transaction a unit of work reads and writes through. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

/**
 * Where a piece of work reads and writes: one organization, and the only way to its data.
 * Nothing picks an organization by itself: the tRPC context, the sync schedule or the CLI says
 * which.
 *
 * `run` is one unit of work: a short transaction in which row-level security lets the work see
 * and change that organization's rows and nobody else's (see db/schema.ts). Keep units short:
 * never wait on another service inside one, and save what a service returned in a unit of its
 * own. A `run` inside another `run` of the same scope joins it.
 */
export interface Scope {
  readonly organizationId: string
  run<T>(work: (tx: Tx) => Promise<T>): Promise<T>
}

interface OpenUnit {
  db: Db
  organizationId: string
  tx: Tx
  /** Set when the transaction has ended; work started from inside it then opens its own. */
  ended: boolean
}

const open = new AsyncLocalStorage<OpenUnit>()

/** The scope of an organization on a database. */
export function scopeFor(db: Db, organizationId: string): Scope {
  return {
    organizationId,
    async run(work) {
      const current = open.getStore()
      if (current && !current.ended && current.db === db) {
        if (current.organizationId !== organizationId) {
          throw new Error('A unit of work of one organization cannot run work of another inside it.')
        }
        return work(current.tx)
      }
      const { role } = await tenancyOf(db)
      return db.transaction(async (tx) => {
        await tx.execute(
          role
            ? sql`select set_config('role', ${role}, true), set_config('app.organization_id', ${organizationId}, true)`
            : sql`select set_config('app.organization_id', ${organizationId}, true)`,
        )
        const unit: OpenUnit = { db, organizationId, tx, ended: false }
        try {
          return await open.run(unit, () => work(tx))
        } finally {
          unit.ended = true
        }
      })
    },
  }
}
