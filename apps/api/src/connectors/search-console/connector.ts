import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import { z } from 'zod'
import { autoLink, linkedAssets, upsertAssets } from '../../assets/store.js'
import type { Scope, Tx } from '../../organizations/scope.js'
import { apps, assets, connections, type NewMetric } from '../../db/schema.js'
import type { Secrets } from '../../lib/crypto.js'
import { eachDay } from '../../lib/dates.js'
import { mapLimit } from '../../lib/pool.js'
import { upsertMetrics } from '../../metrics/upsert.js'
import { GoogleAuthError, serviceAccountSchema } from '../google-play/auth.js'
import type { AccountConnector } from '../types.js'
import {
  SEARCH_CONSOLE,
  SearchConsoleError,
  createSearchConsoleClient,
  siteName,
  type SearchSite,
} from './client.js'

const credentialsSchema = z.object({ serviceAccount: serviceAccountSchema })
export type SearchConsoleCredentials = z.infer<typeof credentialsSchema>

/** The organization's Search Console service account. */
export const findSearchConsoleConnection = (scope: Scope) =>
  scope
    .run((db) =>
      db
        .select()
        .from(connections)
        .where(and(eq(connections.organizationId, scope.organizationId), eq(connections.provider, SEARCH_CONSOLE)))
        .limit(1),
    )
    .then((rows) => rows[0])

export const readSearchConsoleCredentials = (secrets: Secrets, encrypted: string): SearchConsoleCredentials =>
  credentialsSchema.parse(JSON.parse(secrets.decrypt(encrypted)))

export interface SearchConsoleOptions {
  fetch?: typeof fetch
  baseUrl?: string
}

/** Saves each property as a website asset; which app it belongs to is the person's call. */
export async function saveSites(scope: Scope, connectionId: string, sites: SearchSite[]) {
  // No call to Google in here: one unit of work.
  return scope.run((db) => saveSitesIn(db, scope, connectionId, sites))
}

async function saveSitesIn(db: Tx, scope: Scope, connectionId: string, sites: SearchSite[]) {
  const { organizationId } = scope
  await upsertAssets(
    scope,
    sites.map((site) => ({
      kind: 'search_console_site' as const,
      externalId: site.siteUrl,
      name: siteName(site.siteUrl),
      connectionId,
      details: { permissionLevel: site.permissionLevel },
    })),
  )
  await autoLink(scope)
  const linked = await db
    .select({ id: assets.id })
    .from(assets)
    .where(
      and(
        eq(assets.organizationId, organizationId),
        eq(assets.kind, 'search_console_site'),
        inArray(
          assets.externalId,
          sites.map((site) => site.siteUrl),
        ),
        isNotNull(assets.appId),
      ),
    )
  return linked.length
}

/**
 * Google search clicks, impressions and average position per day for each website linked to
 * an app, from Search Console. Google posts a day two or three days late. Position is kept as
 * a sum weighted by impressions, so days and sites add up to a true average.
 */
export function createSearchConsoleConnector(options: SearchConsoleOptions = {}): AccountConnector {
  return {
    source: SEARCH_CONSOLE,
    scope: 'account',

    async isConfigured(scope) {
      return (await findSearchConsoleConnection(scope)) !== undefined
    },

    async sync(scope) {
      const { organizationId, range, secrets } = scope
      const connection = await findSearchConsoleConnection(scope)
      if (!connection?.accessTokenEnc) throw new Error('No Search Console service account is stored')
      const { serviceAccount } = readSearchConsoleCredentials(secrets, connection.accessTokenEnc)
      const client = createSearchConsoleClient({ serviceAccount, ...options })

      try {
        // Picks up properties shared with the service account since the last run.
        const sites = await client.listSites()
        await saveSites(scope, connection.id, sites)

        const active = new Set(
          (
            await scope.run((db) =>
              db
                .select({ id: apps.id })
                .from(apps)
                .where(and(eq(apps.organizationId, organizationId), eq(apps.isActive, true))),
            )
          ).map((app) => app.id),
        )
        const owned = new Set(sites.map((site) => site.siteUrl))
        const tracked = (await linkedAssets(scope, 'search_console_site'))
          .map(({ asset }) => asset)
          .filter((asset) => asset.connectionId === connection.id && asset.appId !== null && active.has(asset.appId))
          .filter((asset) => owned.has(asset.externalId))

        const rows: NewMetric[] = []
        await mapLimit(tracked, 3, async (asset) => {
          const appId = asset.appId ?? ''
          const days = await client.daily(asset.externalId, range.from, range.to)
          if (days.length === 0) return
          // Google leaves out days without impressions; up to its latest day those are zeros.
          // Days after it are not in yet, and stay empty.
          const latest = days.reduce((max, day) => (day.date > max ? day.date : max), days[0]?.date ?? range.from)
          const byDate = new Map(days.map((day) => [day.date, day]))
          for (const date of eachDay({ from: range.from, to: latest })) {
            const day = byDate.get(date)
            const push = (metric: string, value: number) => rows.push({ appId, date, source: SEARCH_CONSOLE, metric, value })
            push('search_clicks', day?.clicks ?? 0)
            push('search_impressions', day?.impressions ?? 0)
            push('search_position_sum', day ? day.position * day.impressions : 0)
          }
        })

        const written = await upsertMetrics(scope, rows)
        await scope.run((db) =>
          db
            .update(connections)
            .set({ status: 'ok', lastSyncedAt: new Date(), updatedAt: new Date() })
            .where(and(eq(connections.organizationId, scope.organizationId), eq(connections.id, connection.id))),
        )
        return { rowsWritten: written }
      } catch (err) {
        const lostAccess =
          (err instanceof GoogleAuthError && err.code === 'invalid_grant') ||
          (err instanceof SearchConsoleError && err.isAccessProblem)
        await scope.run((db) =>
          db
            .update(connections)
            .set({ status: lostAccess ? 'needs_reauth' : 'error', updatedAt: new Date() })
            .where(and(eq(connections.organizationId, scope.organizationId), eq(connections.id, connection.id))),
        )
        throw err
      }
    },
  }
}
