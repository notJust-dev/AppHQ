import { asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { appIcons } from '../assets/icons.js'
import { ASSET_KINDS, isAssetKind } from '../assets/kinds.js'
import { apps, assets, connections, metricDaily } from '../db/schema.js'
import { defineQuery } from './define.js'

export const listApps = defineQuery({
  name: 'list_apps',
  description:
    'Lists the apps in the portfolio with their ids, which data sources have data for each, and ' +
    'the assets that feed each one (iOS app, Android app, RevenueCat project, Facebook Pages, ' +
    'Instagram and TikTok accounts) with the state of the account behind each. The app with ' +
    'kind "portfolio" holds accounts shared by several apps.',
  input: z.void(),
  async handler({ db }) {
    const [rows, sourceRows, assetRows, icons] = await Promise.all([
      db.select().from(apps).where(eq(apps.isActive, true)).orderBy(asc(apps.name)),
      db
        .select({ appId: metricDaily.appId, source: metricDaily.source })
        .from(metricDaily)
        .groupBy(metricDaily.appId, metricDaily.source),
      // Never the token columns: credentials do not leave the API.
      db
        .select({
          id: assets.id,
          appId: assets.appId,
          kind: assets.kind,
          name: assets.name,
          externalId: assets.externalId,
          provider: connections.provider,
          status: connections.status,
          lastSyncedAt: connections.lastSyncedAt,
        })
        .from(assets)
        .leftJoin(connections, eq(connections.id, assets.connectionId))
        .orderBy(asc(assets.kind), asc(assets.name)),
      appIcons(db),
    ])

    const sourcesByApp = new Map<string, string[]>()
    for (const { appId, source } of sourceRows) {
      sourcesByApp.set(appId, [...(sourcesByApp.get(appId) ?? []), source])
    }

    // Apps first, then the portfolio row.
    const ordered = [...rows.filter((app) => app.kind !== 'portfolio'), ...rows.filter((app) => app.kind === 'portfolio')]
    return ordered.map((app) => ({
      id: app.id,
      name: app.name,
      kind: app.kind,
      // An icon set on the app itself wins over its iOS app's.
      iconUrl: app.iconUrl ?? icons.get(app.id) ?? null,
      sources: (sourcesByApp.get(app.id) ?? []).sort(),
      assets: assetRows
        .filter((asset) => asset.appId === app.id)
        .map(({ appId: _appId, lastSyncedAt, status, ...asset }) => ({
          ...asset,
          // The data source it feeds, e.g. `tiktok`, whether or not an account stands behind it.
          source: isAssetKind(asset.kind) ? ASSET_KINDS[asset.kind].provider : asset.kind,
          // Demo assets have no account behind them.
          status: status ?? 'ok',
          lastSyncedAt: lastSyncedAt?.toISOString() ?? null,
        })),
    }))
  },
})
