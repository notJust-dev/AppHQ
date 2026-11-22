import { z } from 'zod'
import { mapLimit } from '../../lib/pool.js'
import { AppStoreError, ICON_SIZE, type AppStoreClient } from './client.js'

// Overridable like the App Store Connect address, so a local stand-in can answer.
const LOOKUP_URL = process.env.ITUNES_LOOKUP_URL ?? 'https://itunes.apple.com/lookup'
const LOOKUP_BATCH = 100

const lookupResults = z.object({
  results: z.array(z.object({ trackId: z.number(), artworkUrl512: z.string().optional() })),
})

/**
 * Each app's icon by Apple ID: from its newest build in App Store Connect, else from its public
 * App Store listing, which needs no key but only knows apps on sale in the US store. Icons only
 * decorate, so nothing here throws: an app Apple says nothing about is left out of the map.
 */
export async function fetchAppIcons(options: {
  client: AppStoreClient
  appleIds: string[]
  fetch?: typeof fetch
}): Promise<Map<string, string>> {
  const icons = new Map<string, string>()

  // Reading builds needs a role a sales-only key lacks; one refusal settles it for every app.
  let refused = false
  await mapLimit(options.appleIds, 4, async (appleId) => {
    if (refused) return
    try {
      const icon = await options.client.latestBuildIcon(appleId)
      if (icon) icons.set(appleId, icon)
    } catch (err) {
      if (err instanceof AppStoreError && err.isAuthProblem) refused = true
    }
  })

  const missing = options.appleIds.filter((appleId) => !icons.has(appleId))
  for (const [appleId, icon] of await lookupIcons(missing, options.fetch ?? fetch)) icons.set(appleId, icon)
  return icons
}

/** Icons from the public App Store listing, many apps per request. */
async function lookupIcons(appleIds: string[], doFetch: typeof fetch): Promise<Map<string, string>> {
  const found = new Map<string, string>()
  for (let i = 0; i < appleIds.length; i += LOOKUP_BATCH) {
    try {
      const ids = appleIds.slice(i, i + LOOKUP_BATCH).join(',')
      const response = await doFetch(`${LOOKUP_URL}?id=${ids}`, { signal: AbortSignal.timeout(15_000) })
      if (!response.ok) continue
      const parsed = lookupResults.safeParse(await response.json())
      for (const app of parsed.data?.results ?? []) {
        if (app.artworkUrl512) found.set(String(app.trackId), resized(app.artworkUrl512))
      }
    } catch {
      // Unreachable or unreadable: those apps keep the icon they had, if any.
    }
  }
  return found
}

/** Apple's image links end in the size, e.g. `.../512x512bb.jpg`; ask for the size builds use. */
const resized = (url: string) => url.replace(/\/\d+x\d+bb\.(\w+)$/, `/${ICON_SIZE}x${ICON_SIZE}bb.$1`)
