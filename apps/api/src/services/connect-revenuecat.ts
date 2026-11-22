import { eq } from 'drizzle-orm'
import { autoLink, upsertAssets } from '../assets/store.js'
import { RevenueCatError, createRevenueCatClient } from '../connectors/revenuecat/client.js'
import { REVENUECAT } from '../connectors/revenuecat/connector.js'
import type { Db } from '../db/client.js'
import { apps, assets, connections } from '../db/schema.js'
import type { Secrets } from '../lib/crypto.js'

export interface ConnectedProject {
  name: string
  /** The app the project belongs to, or null while it waits on the Apps page. */
  appId: string | null
  appName: string | null
}

/**
 * Connects the projects behind a RevenueCat secret key: stores the key encrypted, saves each
 * project as an asset, and links it to the app exact evidence points at (an iOS app or Android
 * package the project names). No app is created: a project without one waits on the Apps page.
 * Connecting the same project again replaces its key.
 */
export async function connectRevenueCat(
  deps: { db: Db; secrets: Secrets; fetch?: typeof fetch },
  apiKey: string,
): Promise<ConnectedProject[]> {
  // Encrypt first: if the key cannot be stored, fail before sending it anywhere.
  const encryptedKey = deps.secrets.encrypt(apiKey)
  const client = createRevenueCatClient({ apiKey, fetch: deps.fetch })

  const projects = await client.listProjects()
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
      .values({ provider: REVENUECAT, externalAccountId: project.id, ...values })
      .onConflictDoUpdate({ target: [connections.provider, connections.externalAccountId], set: values })
      .returning({ id: connections.id })
    if (!connection) throw new Error('could not save the RevenueCat connection')

    const [asset] = await upsertAssets(deps.db, [
      {
        kind: 'revenuecat_project',
        externalId: project.id,
        name: project.name,
        connectionId: connection.id,
        details: { bundleId, androidPackage },
      },
    ])
    if (!asset) throw new Error('could not save the RevenueCat project')
    await autoLink(deps.db)

    const [current] = await deps.db.select().from(assets).where(eq(assets.id, asset.id)).limit(1)
    const appId = current?.appId ?? null
    const [app] = appId
      ? await deps.db.select({ name: apps.name }).from(apps).where(eq(apps.id, appId)).limit(1)
      : []
    connected.push({ name: project.name, appId, appName: app?.name ?? null })
  }

  return connected
}
