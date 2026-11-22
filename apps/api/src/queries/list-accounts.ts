import { and, asc, isNull, notInArray } from 'drizzle-orm'
import { z } from 'zod'
import { META_PROVIDERS } from '../connectors/meta/config.js'
import { connections } from '../db/schema.js'
import { defineQuery } from './define.js'

export const listAccounts = defineQuery({
  name: 'list_accounts',
  description:
    'Connected accounts that cover every app, such as App Store Connect, with their state and ' +
    'when they last synced.',
  input: z.void(),
  async handler({ db }) {
    // Never the token columns: credentials do not leave the API. Facebook Pages and Instagram
    // accounts not yet given an app are listed by `list_meta_accounts` instead.
    const rows = await db
      .select({
        provider: connections.provider,
        displayName: connections.displayName,
        status: connections.status,
        lastSyncedAt: connections.lastSyncedAt,
      })
      .from(connections)
      .where(and(isNull(connections.appId), notInArray(connections.provider, [...META_PROVIDERS])))
      .orderBy(asc(connections.provider))

    return rows.map((row) => ({ ...row, lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null }))
  },
})
