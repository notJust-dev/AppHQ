import { and, eq, ne } from 'drizzle-orm'
import { assignAsset, autoLink, upsertAssets } from '../assets/store.js'
import { RevenueCatError, createRevenueCatClient } from '../connectors/revenuecat/client.js'
import { REVENUECAT } from '../connectors/revenuecat/connector.js'
import type { Db } from '../db/client.js'
import type { Scope } from '../organizations/scope.js'
import { apps, assets, connections } from '../db/schema.js'
import type { Secrets } from '../lib/crypto.js'
import { ConnectInputError } from './errors.js'

export interface ConnectedProject {
  name: string
  /** The app the project belongs to, or null while it waits on the Apps page. */
  appId: string | null
  appName: string | null
  /** The app the project fed before, when connecting it to a chosen app moved it. */
  movedFrom: string | null
  /** The project the chosen app had before, which now waits on the Apps page. */
  replaced: string | null
}

/**
 * Connects the projects behind a RevenueCat secret key: stores the key encrypted, saves each
 * project as an asset, and links it to the app exact evidence points at (an iOS app or Android
 * package the project names). No app is created: a project without one waits on the Apps page.
 * Connecting the same project again replaces its key.
 *
 * With `appId`, the key is being added from that app's settings: its project goes to that app,
 * whatever its bundle id says, and the key must belong to exactly one project.
 */
export async function connectRevenueCat(
  deps: { db: Db; organizationId: string; secrets: Secrets; fetch?: typeof fetch },
  apiKey: string,
  options: { appId?: string } = {},
): Promise<ConnectedProject[]> {
  const scope = { db: deps.db, organizationId: deps.organizationId }
  const inOrg = eq(assets.organizationId, deps.organizationId)
  if (options.appId !== undefined) {
    const [target] = await deps.db
      .select({ id: apps.id, kind: apps.kind })
      .from(apps)
      .where(and(eq(apps.organizationId, deps.organizationId), eq(apps.id, options.appId)))
      .limit(1)
    if (!target || target.kind === 'portfolio') {
      throw new ConnectInputError('That app no longer exists. Reload the page.')
    }
  }

  // Encrypt first: if the key cannot be stored, fail before sending it anywhere.
  const encryptedKey = deps.secrets.encrypt(apiKey)
  const client = createRevenueCatClient({ apiKey, fetch: deps.fetch })

  const projects = await client.listProjects()
  if (options.appId !== undefined && projects.length > 1) {
    throw new ConnectInputError(
      `This key can see ${projects.length} projects. Use a secret key from the one project that belongs to this app.`,
    )
  }
  const connected: ConnectedProject[] = []

  for (const project of projects) {
    // The store apps only fill in bundle id and package name. A key without permission to read
    // them can still connect.
    const storeApps = await client.listApps(project.id).catch((err: unknown) => {
      if (err instanceof RevenueCatError && err.isAuthProblem) return []
      throw err
    })
    const bundleId = storeApps.find((app) => app.type === 'app_store')?.app_store?.bundle_id ?? null
    const androidPackage = storeApps.find((app) => app.type === 'play_store')?.play_store?.package_name ?? null

    const values = { displayName: project.name, accessTokenEnc: encryptedKey, status: 'ok', updatedAt: new Date() }
    const [connection] = await deps.db
      .insert(connections)
      .values({ organizationId: deps.organizationId, provider: REVENUECAT, externalAccountId: project.id, ...values })
      .onConflictDoUpdate({ target: [connections.organizationId, connections.provider, connections.externalAccountId], set: values })
      .returning({ id: connections.id })
    if (!connection) throw new Error('could not save the RevenueCat connection')

    const [asset] = await upsertAssets(scope, [
      {
        kind: 'revenuecat_project',
        externalId: project.id,
        name: project.name,
        connectionId: connection.id,
        details: { bundleId, androidPackage },
      },
    ])
    if (!asset) throw new Error('could not save the RevenueCat project')

    let movedFrom: string | null = null
    let replaced: string | null = null
    if (options.appId !== undefined) {
      const [before] = await deps.db
        .select({ appId: assets.appId })
        .from(assets)
        .where(and(inOrg, eq(assets.id, asset.id)))
        .limit(1)
      if (before?.appId && before.appId !== options.appId) movedFrom = await appName(scope, before.appId)
      const [previous] = await deps.db
        .select({ name: assets.name })
        .from(assets)
        .where(
          and(inOrg, eq(assets.kind, 'revenuecat_project'), eq(assets.appId, options.appId), ne(assets.id, asset.id)),
        )
        .limit(1)
      replaced = previous?.name ?? null
      await assignAsset(scope, { assetId: asset.id, appId: options.appId })
    } else {
      await autoLink(scope)
    }

    const [current] = await deps.db.select().from(assets).where(and(inOrg, eq(assets.id, asset.id))).limit(1)
    const appId = current?.appId ?? null
    connected.push({
      name: project.name,
      appId,
      appName: appId ? await appName(scope, appId) : null,
      movedFrom,
      replaced,
    })
  }

  return connected
}

async function appName({ db, organizationId }: Scope, appId: string): Promise<string | null> {
  const [app] = await db
    .select({ name: apps.name })
    .from(apps)
    .where(and(eq(apps.organizationId, organizationId), eq(apps.id, appId)))
    .limit(1)
  return app?.name ?? null
}
