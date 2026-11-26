import { and, asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { iconOf } from '../assets/icons.js'
import { ASSET_KINDS, type AssetKind } from '../assets/kinds.js'
import { suggestApp } from '../assets/store.js'
import { apps, assets, connections } from '../db/schema.js'
import { sameConnection } from '../organizations/joins.js'
import { defineQuery } from './define.js'

export const listAssets = defineQuery({
  name: 'list_assets',
  description:
    'Everything the connected accounts give access to (iOS and Android apps, RevenueCat ' +
    'projects, Facebook Pages, Instagram and TikTok accounts), each with the app it belongs to ' +
    '(null when it has none yet), whether it is ignored, the account it was found through, and ' +
    'for one without an app, the app its name suggests.',
  input: z.void(),
  async handler(scope) {
    return scope.run(async (db) => {
      const { organizationId } = scope
      const [rows, appRows] = await Promise.all([
        db
          .select({
            id: assets.id,
            kind: assets.kind,
            name: assets.name,
            externalId: assets.externalId,
            appId: assets.appId,
            ignored: assets.ignored,
            details: assets.details,
            provider: connections.provider,
            account: connections.displayName,
            status: connections.status,
            lastSyncedAt: connections.lastSyncedAt,
          })
          .from(assets)
          .leftJoin(connections, sameConnection)
          .where(eq(assets.organizationId, organizationId))
          .orderBy(asc(assets.kind), asc(assets.name)),
        db
          .select({ id: apps.id, name: apps.name, kind: apps.kind })
          .from(apps)
          .where(and(eq(apps.organizationId, organizationId), eq(apps.isActive, true))),
      ])

      const candidates = appRows.filter((app) => app.kind !== 'portfolio')
      return rows.map(({ details, lastSyncedAt, ...row }) => {
        const kind = ASSET_KINDS[row.kind as AssetKind]
        const takenSlot = (appId: string) =>
          kind?.slot === 'one' && rows.some((other) => other.kind === row.kind && other.appId === appId)
        const suggested =
          row.appId === null && !row.ignored ? suggestApp({ name: row.name, details }, candidates) : null
        return {
          ...row,
          label: kind?.label ?? row.kind,
          social: kind?.social ?? false,
          bundleId: (details as { bundleId?: string } | null)?.bundleId ?? null,
          iconUrl: iconOf(details),
          status: row.status ?? 'ok',
          lastSyncedAt: lastSyncedAt?.toISOString() ?? null,
          // A suggestion is only worth making if the app has room for it.
          suggestedAppId: suggested && !takenSlot(suggested) ? suggested : null,
        }
      })
    })
  },
})
