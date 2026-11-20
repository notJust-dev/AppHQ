import { asc, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { connections } from '../db/schema.js'
import { defineQuery } from './define.js'

export const listAccounts = defineQuery({
  name: 'list_accounts',
  description:
    'Connected accounts that cover every app, such as App Store Connect, with their state and ' +
    'when they last synced.',
  input: z.void(),
  async handler({ db }) {
    // Never the token columns: credentials do not leave the API.
    const rows = await db
      .select({
        provider: connections.provider,
        displayName: connections.displayName,
        status: connections.status,
        lastSyncedAt: connections.lastSyncedAt,
      })
      .from(connections)
      .where(isNull(connections.appId))
      .orderBy(asc(connections.provider))

    return rows.map((row) => ({ ...row, lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null }))
  },
})
