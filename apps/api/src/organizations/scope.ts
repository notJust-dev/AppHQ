import type { Db } from '../db/client.js'

/**
 * Where a piece of work reads and writes: a database handle and the organization it works in.
 * Every query and every write to tenant data takes one. Nothing picks an organization by
 * itself: the tRPC context, the sync schedule or the CLI says which.
 */
export interface Scope {
  db: Db
  organizationId: string
}
