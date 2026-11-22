import { asc, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { META_PROVIDERS } from '../connectors/meta/config.js'
import { connections } from '../db/schema.js'
import { defineQuery } from './define.js'

export const listMetaAccounts = defineQuery({
  name: 'list_meta_accounts',
  description:
    'The Facebook Pages and Instagram accounts found by the Facebook sign-in, each with the app ' +
    'it promotes (null when it is not tracked), its state, when it last synced, when the ' +
    'sign-in behind it has to be renewed, and the permissions that sign-in was granted (null ' +
    'when unknown).',
  input: z.void(),
  async handler({ db }) {
    const rows = await db
      .select({
        id: connections.id,
        provider: connections.provider,
        displayName: connections.displayName,
        appId: connections.appId,
        status: connections.status,
        expiresAt: connections.expiresAt,
        lastSyncedAt: connections.lastSyncedAt,
        scopes: connections.scopes,
      })
      .from(connections)
      .where(inArray(connections.provider, [...META_PROVIDERS]))
      .orderBy(asc(connections.provider), asc(connections.displayName))

    return rows.map((row) => ({
      ...row,
      scopes: row.scopes ? row.scopes.split(',') : null,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
    }))
  },
})
