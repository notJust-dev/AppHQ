import { eq } from 'drizzle-orm'
import { RevenueCatError, createRevenueCatClient } from '../connectors/revenuecat/client.js'
import { REVENUECAT } from '../connectors/revenuecat/connector.js'
import type { Db } from '../db/client.js'
import { apps, connections } from '../db/schema.js'
import type { Secrets } from '../lib/crypto.js'
import { uniqueSlug } from '../lib/slug.js'

export interface ConnectedApp {
  appId: string
  name: string
  /** False when the project was already known and only its key was replaced. */
  created: boolean
}

/**
 * Registers the app behind a RevenueCat secret key: looks up the project the key belongs to,
 * creates the app if it is new, and stores the key encrypted. Connecting the same project again
 * replaces its key.
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
    const iosBundleId =
      storeApps.find((app) => app.type === 'app_store')?.app_store?.bundle_id ?? null
    const androidPackage =
      storeApps.find((app) => app.type === 'play_store')?.play_store?.package_name ?? null

    connected.push(
      await deps.db.transaction(async (tx) => {
        // The project may already be known, or its app may have arrived from a store account.
        const known = await tx.select().from(apps)
        const existing =
          known.find((app) => app.revenuecatProjectId === project.id) ??
          known.find(
            (app) =>
              app.revenuecatProjectId === null &&
              ((iosBundleId !== null && app.iosBundleId === iosBundleId) ||
                (androidPackage !== null && app.androidPackage === androidPackage)),
          )

        let appId: string
        if (existing) {
          appId = existing.id
          await tx
            .update(apps)
            .set({
              revenuecatProjectId: project.id,
              iosBundleId: existing.iosBundleId ?? iosBundleId,
              androidPackage: existing.androidPackage ?? androidPackage,
              isActive: true,
            })
            .where(eq(apps.id, appId))
        } else {
          appId = uniqueSlug(project.name, new Set(known.map((app) => app.id)))
          await tx.insert(apps).values({
            id: appId,
            name: project.name,
            revenuecatProjectId: project.id,
            iosBundleId,
            androidPackage,
          })
        }

        const connection = {
          appId,
          displayName: project.name,
          accessTokenEnc: encryptedKey,
          status: 'ok',
          updatedAt: new Date(),
        }
        await tx
          .insert(connections)
          .values({ provider: REVENUECAT, externalAccountId: project.id, ...connection })
          .onConflictDoUpdate({
            target: [connections.provider, connections.externalAccountId],
            set: connection,
          })

        return { appId, name: existing?.name ?? project.name, created: !existing }
      }),
    )
  }

  return connected
}
