import { and, eq } from 'drizzle-orm'
import { assets, connections } from '../db/schema.js'

/**
 * Joins an asset to the account it was found through, in the asset's own organization. Ids are
 * unique anyway; the organization is matched too so a join can never cross organizations.
 */
export const sameConnection = and(
  eq(connections.id, assets.connectionId),
  eq(connections.organizationId, assets.organizationId),
)
