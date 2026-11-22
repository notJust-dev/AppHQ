import { asc } from 'drizzle-orm'
import { z } from 'zod'
import { readAnalyticsState } from '../connectors/app-store/analytics.js'
import { assets, connections } from '../db/schema.js'
import { defineQuery } from './define.js'

/** Sources as people know them: Facebook and Instagram arrive through one Meta sign-in. */
export const ACCOUNT_FAMILIES = ['app_store', 'google_play', 'revenuecat', 'meta', 'tiktok'] as const
export type AccountFamily = (typeof ACCOUNT_FAMILIES)[number]

const familyOf = (provider: string): AccountFamily | null =>
  provider === 'facebook' || provider === 'instagram'
    ? 'meta'
    : (ACCOUNT_FAMILIES as readonly string[]).includes(provider)
      ? (provider as AccountFamily)
      : null

export const listAccounts = defineQuery({
  name: 'list_accounts',
  description:
    'The connected accounts, grouped by source (App Store Connect, Google Play, RevenueCat, ' +
    'Meta for Facebook and Instagram, TikTok): each sign-in or key with its state, when it last ' +
    'synced and when it expires, a note when it needs the person (an App Store key that may not ' +
    'start analytics reports, say), and how many assets the source found, how many belong to an ' +
    'app, and how many wait for a decision.',
  input: z.void(),
  async handler({ db }) {
    // Never the token columns: credentials do not leave the API.
    const [rows, assetRows] = await Promise.all([
      db
        .select({
          id: connections.id,
          provider: connections.provider,
          externalAccountId: connections.externalAccountId,
          displayName: connections.displayName,
          status: connections.status,
          lastSyncedAt: connections.lastSyncedAt,
          expiresAt: connections.expiresAt,
          scopes: connections.scopes,
          details: connections.details,
        })
        .from(connections)
        .orderBy(asc(connections.provider), asc(connections.displayName)),
      db.select({ connectionId: assets.connectionId, appId: assets.appId, ignored: assets.ignored }).from(assets),
    ])

    return ACCOUNT_FAMILIES.map((family) => {
      const accounts = rows.filter((row) => familyOf(row.provider) === family)
      const ids = new Set(accounts.map((account) => account.id))
      const found = assetRows.filter((asset) => asset.connectionId !== null && ids.has(asset.connectionId))
      return {
        family,
        accounts: accounts.map(({ details, ...account }) => ({
          ...account,
          /** Something about the account the person should act on, in their words. */
          note: noteFor(account.provider, details),
          scopes: account.scopes ? account.scopes.split(',') : null,
          lastSyncedAt: account.lastSyncedAt?.toISOString() ?? null,
          expiresAt: account.expiresAt?.toISOString() ?? null,
        })),
        assets: {
          total: found.length,
          linked: found.filter((asset) => asset.appId !== null).length,
          waiting: found.filter((asset) => asset.appId === null && !asset.ignored).length,
          ignored: found.filter((asset) => asset.ignored).length,
        },
      }
    })
  },
})

function noteFor(provider: string, details: unknown): string | null {
  if (provider === 'app_store' && readAnalyticsState(details).needsAdmin) {
    return (
      'This key may not ask Apple for analytics reports, so store page views and impressions ' +
      'cannot start. Connect once with an Admin key; a Sales and Reports key can read them after that.'
    )
  }
  return null
}
