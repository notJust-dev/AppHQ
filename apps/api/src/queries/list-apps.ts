import { asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { apps, connections, metricDaily } from '../db/schema.js'
import { defineQuery } from './define.js'

export const listApps = defineQuery({
  name: 'list_apps',
  description:
    'Lists the apps in the portfolio with their ids, which data sources have data for each, ' +
    'and the state of each connected account.',
  input: z.void(),
  async handler({ db }) {
    const [rows, sourceRows, connectionRows] = await Promise.all([
      db.select().from(apps).where(eq(apps.isActive, true)).orderBy(asc(apps.name)),
      db
        .select({ appId: metricDaily.appId, source: metricDaily.source })
        .from(metricDaily)
        .groupBy(metricDaily.appId, metricDaily.source),
      // Never the token columns: credentials do not leave the API.
      db
        .select({
          appId: connections.appId,
          provider: connections.provider,
          status: connections.status,
          lastSyncedAt: connections.lastSyncedAt,
        })
        .from(connections),
    ])

    const sourcesByApp = new Map<string, string[]>()
    for (const { appId, source } of sourceRows) {
      sourcesByApp.set(appId, [...(sourcesByApp.get(appId) ?? []), source])
    }

    return rows.map((app) => ({
      id: app.id,
      name: app.name,
      iconUrl: app.iconUrl,
      hasIos: app.iosAppId !== null || app.iosBundleId !== null,
      hasAndroid: app.androidPackage !== null,
      sources: (sourcesByApp.get(app.id) ?? []).sort(),
      connections: connectionRows
        .filter((connection) => connection.appId === app.id)
        .map(({ provider, status, lastSyncedAt }) => ({
          provider,
          status,
          lastSyncedAt: lastSyncedAt?.toISOString() ?? null,
        })),
    }))
  },
})
