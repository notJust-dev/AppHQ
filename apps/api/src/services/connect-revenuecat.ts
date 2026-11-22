import { eq } from 'drizzle-orm'
import { autoLink, createApp, upsertAssets } from '../assets/store.js'
import { RevenueCatError, createRevenueCatClient } from '../connectors/revenuecat/client.js'
import { REVENUECAT } from '../connectors/revenuecat/connector.js'
import type { Db } from '../db/client.js'
import { apps, assets, connections } from '../db/schema.js'
import type { Secrets } from '../lib/crypto.js'

export interface ConnectedApp {
  appId: string
  name: string
  /** False when the project went to an app that was already there. */
  created: boolean
}

/**
 * Connects the projects behind a RevenueCat secret key: stores the key encrypted, saves each
 * project as an asset, and links it to the app exact evidence points at (an iOS app or Android
 * package the project names). A project seen for the first time with no such app gets an app of
 * its own. Connecting the same project again replaces its key.
 */
export async function connectRevenueCat(
  deps: { db: Db; secrets: Secrets; fetch?: typeof fetch },
  apiKey: string,
): Promise<ConnectedApp[]> {
  // Encrypt first: if the key cannot be stored, fail before sending it anywhere.
  const encryptedKey = deps.secrets.encrypt(apiKey)
  const client = createRevenueCatClient({ apiKey, fetch: deps.fetch })

  const projects = await client.listProjects()
  const connected: ConnectedApp[] = []

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

    const [known] = await deps.db
      .select({ id: assets.id })
      .from(assets)
      .where(eq(assets.externalId, project.id))
      .limit(1)
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
    let appId = current?.appId ?? null
    let created = false
    if (appId === null && !known && !current?.ignored) {
      appId = await createApp(deps.db, project.name)
      await deps.db.update(assets).set({ appId, updatedAt: new Date() }).where(eq(assets.id, asset.id))
      await autoLink(deps.db)
      created = true
    }
    if (appId === null) continue

    const [app] = await deps.db.select({ name: apps.name }).from(apps).where(eq(apps.id, appId)).limit(1)
    connected.push({ appId, name: app?.name ?? project.name, created })
  }

  return connected
}
