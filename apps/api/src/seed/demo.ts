import { like } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { apps, type NewApp, type NewMetric } from '../db/schema.js'
import { addDays, parseIsoDate, todayUtc, type IsoDate } from '../lib/dates.js'
import type { Source } from '../metrics/catalog.js'
import { upsertMetrics } from '../metrics/upsert.js'

/**
 * Generated demo data: a few fictional apps whose social views occasionally spike, with store
 * visits, downloads and revenue following a day or a week later. It exists so the dashboard can
 * be developed and recorded without real accounts or real revenue on screen.
 */

const DEMO_PREFIX = 'demo-'

interface Profile {
  id: string
  name: string
  /** Relative size of the app; everything scales with it. */
  scale: number
  monthlyPrice: number
  androidShare: number
}

const PROFILES: Profile[] = [
  { id: 'demo-habitloop', name: 'Habitloop', scale: 1, monthlyPrice: 6.99, androidShare: 0.35 },
  { id: 'demo-trailmate', name: 'Trailmate', scale: 0.55, monthlyPrice: 9.99, androidShare: 0.45 },
  { id: 'demo-dishcraft', name: 'Dishcraft', scale: 0.3, monthlyPrice: 4.99, androidShare: 0.3 },
  { id: 'demo-quillnote', name: 'Quillnote', scale: 0.12, monthlyPrice: 7.99, androidShare: 0.2 },
]

/** Small deterministic PRNG, so the same seed always produces the same dataset. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return h >>> 0
}

export interface DemoOptions {
  /** Number of days to generate. */
  days: number
  /** Last generated day. Defaults to yesterday (UTC), like real sources that lag a day. */
  endDate?: IsoDate
}

export function generateDemoData(options: DemoOptions): { apps: NewApp[]; metrics: NewMetric[] } {
  const endDate = options.endDate ?? addDays(todayUtc(), -1)
  const startDate = addDays(endDate, -(options.days - 1))
  const metrics: NewMetric[] = []

  for (const profile of PROFILES) {
    const { id, scale, monthlyPrice, androidShare } = profile
    const rand = mulberry32(hash(id))
    const noise = (spread: number) => 1 + (rand() * 2 - 1) * spread

    let tiktokBoost = 0
    let instagramBoost = 0
    let tiktokFollowers = Math.round(scale * 18_000)
    let instagramFollowers = Math.round(scale * 7_000)
    let mrr = scale * 4_200
    const socialViews: number[] = []
    const downloadsByDay: number[] = []

    for (let i = 0; i < options.days; i++) {
      const date = addDays(startDate, i)
      const push = (source: Source, metric: string, value: number) =>
        metrics.push({ appId: id, date, source, metric, value })

      const weekday = parseIsoDate(date).getUTCDay()
      const weekend = weekday === 0 || weekday === 6 ? 1.15 : 1

      // A post occasionally takes off, then fades over the following days.
      tiktokBoost *= 0.42
      if (rand() < 0.045) tiktokBoost += scale * (60_000 + rand() * 340_000)
      instagramBoost *= 0.5
      if (rand() < 0.025) instagramBoost += scale * (15_000 + rand() * 90_000)

      const tiktokViews = Math.round(scale * 9_000 * weekend * noise(0.35) + tiktokBoost)
      const instagramViews = Math.round(scale * 3_500 * weekend * noise(0.3) + instagramBoost)
      socialViews.push(tiktokViews + instagramViews)

      tiktokFollowers += Math.round(tiktokViews * 0.002)
      instagramFollowers += Math.round(instagramViews * 0.0015)

      push('tiktok', 'views', tiktokViews)
      push('tiktok', 'likes', Math.round(tiktokViews * 0.075 * noise(0.2)))
      push('tiktok', 'comments', Math.round(tiktokViews * 0.004 * noise(0.3)))
      push('tiktok', 'shares', Math.round(tiktokViews * 0.008 * noise(0.3)))
      push('tiktok', 'followers', tiktokFollowers)
      push('instagram', 'views', instagramViews)
      push('instagram', 'reach', Math.round(instagramViews * 0.7 * noise(0.1)))
      push('instagram', 'likes', Math.round(instagramViews * 0.05 * noise(0.2)))
      push('instagram', 'comments', Math.round(instagramViews * 0.003 * noise(0.3)))
      push('instagram', 'shares', Math.round(instagramViews * 0.006 * noise(0.3)))
      push('instagram', 'followers', instagramFollowers)

      // Store visits follow social views with a short lag, on top of an organic baseline.
      const today = socialViews[i] ?? 0
      const lagged =
        0.6 * today + 0.3 * (socialViews[i - 1] ?? today) + 0.1 * (socialViews[i - 2] ?? today)
      const storeVisits = scale * 900 * noise(0.2) + lagged * 0.011
      const iosVisits = Math.round(storeVisits * (1 - androidShare))
      const androidVisits = Math.round(storeVisits * androidShare)
      const iosDownloads = Math.round(iosVisits * 0.33 * noise(0.1))
      const androidDownloads = Math.round(androidVisits * 0.27 * noise(0.1))
      const downloads = iosDownloads + androidDownloads
      downloadsByDay.push(downloads)

      push('app_store', 'impressions', Math.round(iosVisits * 3.6 * noise(0.1)))
      push('app_store', 'page_views', iosVisits)
      push('app_store', 'downloads', iosDownloads)
      push('google_play', 'page_views', androidVisits)
      push('google_play', 'downloads', androidDownloads)

      // Trials start on download; the ones that convert start paying a week later.
      const converting = (downloadsByDay[i - 7] ?? downloads) * 0.11 * 0.38
      mrr = mrr * (1 - 0.0035) + converting * monthlyPrice
      const revenue = converting * monthlyPrice + (mrr / 30) * noise(0.12)

      push('revenuecat', 'trials', Math.round(downloads * 0.11 * noise(0.15)))
      push('revenuecat', 'revenue', Math.round(revenue * 100) / 100)
      push('revenuecat', 'mrr', Math.round(mrr * 100) / 100)
      push('revenuecat', 'active_subs', Math.round(mrr / monthlyPrice))
    }
  }

  return {
    apps: PROFILES.map(({ id, name }) => ({
      id,
      name,
      iosAppId: `demo.${id}`,
      androidPackage: `demo.${id.replace('-', '.')}`,
    })),
    metrics,
  }
}

/** Replaces the demo apps and their metrics. Real apps (ids without the prefix) are untouched. */
export async function seedDemo(db: Db, options: DemoOptions) {
  const data = generateDemoData(options)
  await db.transaction(async (tx) => {
    // Metrics go with the apps through ON DELETE CASCADE.
    await tx.delete(apps).where(like(apps.id, `${DEMO_PREFIX}%`))
    await tx.insert(apps).values(data.apps)
    await upsertMetrics(tx as unknown as Db, data.metrics)
  })
  return { apps: data.apps.length, metrics: data.metrics.length }
}
