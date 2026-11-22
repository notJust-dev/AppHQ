import { and, eq } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { assets, connections } from '../db/schema.js'

/** The asset of a kind with this external id, or throws: tests expect it to be there. */
export async function assetOf(db: Db, kind: string, externalId: string) {
  const [asset] = await db
    .select()
    .from(assets)
    .where(and(eq(assets.kind, kind), eq(assets.externalId, externalId)))
    .limit(1)
  if (!asset) throw new Error(`no ${kind} asset ${externalId}`)
  return asset
}

/** The connection behind an asset. */
export async function connectionOf(db: Db, kind: string, externalId: string) {
  const asset = await assetOf(db, kind, externalId)
  const [connection] = await db
    .select()
    .from(connections)
    .where(eq(connections.id, asset.connectionId ?? '00000000-0000-0000-0000-000000000000'))
    .limit(1)
  if (!connection) throw new Error(`no connection behind ${kind} ${externalId}`)
  return connection
}
