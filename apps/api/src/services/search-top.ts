import { and, eq } from 'drizzle-orm'
import { createSearchConsoleClient } from '../connectors/search-console/client.js'
import { findSearchConsoleConnection, readSearchConsoleCredentials, type SearchConsoleOptions } from '../connectors/search-console/connector.js'
import type { Db } from '../db/client.js'
import { apps, assets } from '../db/schema.js'
import type { Secrets } from '../lib/crypto.js'
import { mapLimit } from '../lib/pool.js'

const PER_SITE = 200

export interface TopEntry {
  key: string
  clicks: number
  impressions: number
  /** Average position, weighted by impressions. */
  position: number
}

/**
 * The top search queries or pages over a range, for one app's website or every linked one,
 * read live from Search Console (it does not keep them per day in the dashboard). Several
 * sites' queries are merged, with position weighted by impressions.
 */
export async function searchTop(
  deps: { db: Db; secrets: Secrets } & SearchConsoleOptions,
  input: { appId?: string; from: string; to: string; dimension: 'query' | 'page'; limit: number },
): Promise<{ connected: boolean; rows: TopEntry[] }> {
  const connection = await findSearchConsoleConnection(deps.db)
  if (!connection?.accessTokenEnc) return { connected: false, rows: [] }
  const { serviceAccount } = readSearchConsoleCredentials(deps.secrets, connection.accessTokenEnc)
  const client = createSearchConsoleClient({ serviceAccount, fetch: deps.fetch, baseUrl: deps.baseUrl })

  const sites = await deps.db
    .select({ siteUrl: assets.externalId })
    .from(assets)
    .innerJoin(apps, eq(apps.id, assets.appId))
    .where(
      and(
        eq(assets.kind, 'search_console_site'),
        eq(assets.connectionId, connection.id),
        input.appId ? eq(assets.appId, input.appId) : undefined,
      ),
    )

  const merged = new Map<string, { clicks: number; impressions: number; positionSum: number }>()
  await mapLimit(sites, 3, async ({ siteUrl }) => {
    for (const row of await client.top(siteUrl, input.from, input.to, input.dimension, PER_SITE)) {
      const entry = merged.get(row.key) ?? { clicks: 0, impressions: 0, positionSum: 0 }
      entry.clicks += row.clicks
      entry.impressions += row.impressions
      entry.positionSum += row.position * row.impressions
      merged.set(row.key, entry)
    }
  })

  const rows = [...merged]
    .map(([key, entry]) => ({
      key,
      clicks: entry.clicks,
      impressions: entry.impressions,
      position: entry.impressions > 0 ? Math.round((entry.positionSum / entry.impressions) * 10) / 10 : 0,
    }))
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
    .slice(0, input.limit)
  return { connected: true, rows }
}
