import { asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { apps, metricDaily } from '../db/schema.js'
import { defineQuery } from './define.js'

export const listApps = defineQuery({
  name: 'list_apps',
  description:
    'Lists the apps in the portfolio with their ids and which data sources have data for each.',
  input: z.void(),
  async handler({ db }) {
    const [rows, sourceRows] = await Promise.all([
      db.select().from(apps).where(eq(apps.isActive, true)).orderBy(asc(apps.name)),
      db
        .select({ appId: metricDaily.appId, source: metricDaily.source })
        .from(metricDaily)
        .groupBy(metricDaily.appId, metricDaily.source),
    ])

    const sourcesByApp = new Map<string, string[]>()
    for (const { appId, source } of sourceRows) {
      sourcesByApp.set(appId, [...(sourcesByApp.get(appId) ?? []), source])
    }

    return rows.map((app) => ({
      id: app.id,
      name: app.name,
      iconUrl: app.iconUrl,
      hasIos: app.iosAppId !== null,
      hasAndroid: app.androidPackage !== null,
      sources: (sourcesByApp.get(app.id) ?? []).sort(),
    }))
  },
})
