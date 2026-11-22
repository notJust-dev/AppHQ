import { and, eq, isNull, like, or } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { apps, assets, posts, type NewApp, type NewMetric, type NewPost } from '../db/schema.js'
import { addDays, parseIsoDate, todayUtc, type IsoDate } from '../lib/dates.js'
import type { Source } from '../metrics/catalog.js'
import { upsertMetrics } from '../metrics/upsert.js'
import { saveReviews, type ReviewReading } from '../reviews/save.js'

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
  /** Made-up post captions, picked at random. */
  captions: string[]
}

const PROFILES: Profile[] = [
  {
    id: 'demo-habitloop',
    name: 'Habitloop',
    scale: 1,
    monthlyPrice: 6.99,
    androidShare: 0.35,
    captions: [
      'Day 30 of tracking my habits, here is what changed',
      'The two-minute rule fixed my mornings',
      'My habit streaks after 90 days',
      'Three habits that actually stuck this year',
      'Why I stopped trying to change everything at once',
    ],
  },
  {
    id: 'demo-trailmate',
    name: 'Trailmate',
    scale: 0.55,
    monthlyPrice: 9.99,
    androidShare: 0.45,
    captions: [
      'Found this trail an hour from the city',
      'Offline maps saved this hike',
      'Sunrise hike, 6 km, worth every step',
      'How I plan a weekend hike in five minutes',
      'Five trails for your first autumn hike',
    ],
  },
  {
    id: 'demo-dishcraft',
    name: 'Dishcraft',
    scale: 0.3,
    monthlyPrice: 4.99,
    androidShare: 0.3,
    captions: [
      'A 15-minute dinner from whatever is in the fridge',
      'Meal prep for the whole week in one go',
      'This pasta has four ingredients',
      'Turning last night’s leftovers into lunch',
      'The only soup recipe you need this winter',
    ],
  },
  {
    id: 'demo-quillnote',
    name: 'Quillnote',
    scale: 0.12,
    monthlyPrice: 7.99,
    androidShare: 0.2,
    captions: [
      'My journaling setup for 2026',
      'One page a day changed how I think',
      'How I take notes from the books I read',
      'Morning pages, week three',
      'The note-taking mistake I made for years',
    ],
  },
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

export function generateDemoData(options: DemoOptions): {
  apps: NewApp[]
  assets: (typeof assets.$inferInsert)[]
  metrics: NewMetric[]
  posts: NewPost[]
} {
  const endDate = options.endDate ?? addDays(todayUtc(), -1)
  const startDate = addDays(endDate, -(options.days - 1))
  const metrics: NewMetric[] = []
  const demoPosts: NewPost[] = []

  for (const profile of PROFILES) {
    const { id, scale, monthlyPrice, androidShare } = profile
    const rand = mulberry32(hash(id))
    const noise = (spread: number) => 1 + (rand() * 2 - 1) * spread
    // Posts draw from their own sequence, so adding them left every metric exactly as it was.
    const postRand = mulberry32(hash(`${id}:posts`))
    const addPost = (platform: Source, index: number, date: IsoDate, views: number) => {
      const hour = String(13 + Math.floor(postRand() * 8)).padStart(2, '0')
      const minute = String(Math.floor(postRand() * 60)).padStart(2, '0')
      const engagement = (rate: number) => Math.round(views * rate * (0.8 + postRand() * 0.4))
      demoPosts.push({
        platform,
        externalId: `${id}-${platform}-${index}`,
        appId: id,
        caption: profile.captions[Math.floor(postRand() * profile.captions.length)] ?? null,
        publishedAt: new Date(`${date}T${hour}:${minute}:00Z`),
        durationSeconds: 8 + Math.floor(postRand() * 52),
        views,
        likes: engagement(0.075),
        comments: engagement(0.004),
        shares: engagement(0.008),
      })
    }

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

      // A post occasionally takes off, then fades over the following days. Over its life it
      // collects about 1 / (1 - decay) times its first day's boost.
      tiktokBoost *= 0.42
      if (rand() < 0.045) {
        const boost = scale * (60_000 + rand() * 340_000)
        tiktokBoost += boost
        addPost('tiktok', i, date, Math.round(boost / 0.58 + scale * 3_000))
      } else if (postRand() < 0.35) {
        addPost('tiktok', i, date, Math.round(scale * (2_500 + postRand() * 9_000)))
      }
      instagramBoost *= 0.5
      if (rand() < 0.025) {
        const boost = scale * (15_000 + rand() * 90_000)
        instagramBoost += boost
        addPost('instagram', i, date, Math.round(boost / 0.5 + scale * 1_500))
      } else if (postRand() < 0.15) {
        addPost('instagram', i, date, Math.round(scale * (1_200 + postRand() * 4_000)))
      }

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

  const demoAssets = demoAssetsOf()

  return {
    apps: PROFILES.map(({ id, name }) => ({ id, name })),
    assets: demoAssets,
    metrics,
    posts: demoPosts,
  }
}

/** Made-up review texts by star rating; each app's name is put in where it says APP. */
const REVIEW_TEXTS: Record<number, { title: string; body: string }[]> = {
  5: [
    { title: 'Exactly what I needed', body: 'Simple, fast and it just works. APP is now on my home screen.' },
    { title: 'Worth every penny', body: 'Tried a few others before this one. APP is the only one I kept.' },
    { title: 'Love the new update', body: 'The latest version feels smoother and the widgets are great.' },
    { title: 'Five stars', body: 'Clean design and no clutter. Recommended it to my friends.' },
  ],
  4: [
    { title: 'Really good', body: 'Does almost everything I want. A dark mode schedule would make it perfect.' },
    { title: 'Great, one wish', body: 'I use APP every day. Please add an export option.' },
  ],
  3: [{ title: 'Okay so far', body: 'It does the job, but the onboarding is long and the free tier is limited.' }],
  2: [{ title: 'Too pricey', body: 'Nice idea, but the subscription is too much for what it does.' }],
  1: [
    { title: 'Crashes on launch', body: 'Since the last update APP closes right after opening. Please fix.' },
    { title: 'Lost my data', body: 'Switched phones and everything was gone. No way to restore it.' },
  ],
}

const REPLIES = [
  'Thank you for the kind words! We are glad APP helps.',
  'Sorry about that. A fix is in the next update; please write to us if it keeps happening.',
  'Thanks for the idea. It is on our list for the coming months.',
]

/**
 * A few dozen written reviews per demo app over the generated days, mostly good, some not,
 * a third of them answered. The ones from the last fortnight start unread, as real ones do.
 */
export function generateDemoReviews(options: DemoOptions): ReviewReading[] {
  const endDate = options.endDate ?? addDays(todayUtc(), -1)
  const readings: ReviewReading[] = []
  for (const profile of PROFILES) {
    const rand = mulberry32(hash(`${profile.id}:reviews`))
    const count = Math.round(options.days * 0.3 * Math.sqrt(profile.scale))
    for (let i = 0; i < count; i++) {
      const roll = rand()
      const rating = roll < 0.55 ? 5 : roll < 0.75 ? 4 : roll < 0.83 ? 3 : roll < 0.89 ? 2 : 1
      const texts = REVIEW_TEXTS[rating] ?? []
      const text = texts[Math.floor(rand() * texts.length)] ?? { title: 'Review', body: 'Review' }
      const day = addDays(endDate, -Math.floor(rand() * options.days))
      const createdAt = new Date(`${day}T${String(8 + Math.floor(rand() * 12)).padStart(2, '0')}:00:00Z`)
      const android = rand() < profile.androidShare
      const answered = rand() < 0.33
      const fill = (value: string) => value.replace('APP', profile.name)
      readings.push({
        appId: profile.id,
        store: android ? 'google_play' : 'app_store',
        externalId: `${profile.id}-review-${i}`,
        rating,
        title: fill(text.title),
        body: fill(text.body),
        author: android ? null : `user${Math.floor(rand() * 9000 + 1000)}`,
        territory: android ? null : (['USA', 'GBR', 'DEU', 'CAN', 'AUS'][Math.floor(rand() * 5)] ?? 'USA'),
        language: android ? (['en', 'de', 'es'][Math.floor(rand() * 3)] ?? 'en') : null,
        appVersion: `2.${Math.floor(rand() * 4)}.${Math.floor(rand() * 10)}`,
        createdAt,
        reply: answered ? fill(REPLIES[rating >= 4 ? 0 : rating === 3 ? 2 : 1] ?? '') : null,
        repliedAt: answered ? new Date(createdAt.getTime() + 86_400_000) : null,
      })
    }
  }
  return readings
}

/**
 * What each demo app is made of, so the Apps page shows full rows. No account stands behind
 * them, so no connector ever reads them.
 */
function demoAssetsOf() {
  return PROFILES.flatMap(({ id, name }) => {
    const handle = name.toLowerCase()
    // Like most apps, the same identifier on both stores.
    const bundleId = `com.${handle}.app`
    return [
      { kind: 'ios_app', externalId: `demo.${id}`, name, appId: id, details: { bundleId } },
      { kind: 'android_app', externalId: bundleId, name, appId: id, details: { title: name } },
      {
        kind: 'revenuecat_project',
        externalId: `demo-project-${id}`,
        name,
        appId: id,
        details: { bundleId, androidPackage: bundleId },
      },
      { kind: 'tiktok_account', externalId: `demo-tiktok-${id}`, name: `@${handle}.app`, appId: id },
      { kind: 'instagram_account', externalId: `demo-instagram-${id}`, name: `@${handle}`, appId: id },
    ]
  })
}

/**
 * Demo assets have no account behind them; anything with an account is real and stays. That
 * includes a demo asset someone took off its app on the Apps page.
 */
const deleteDemoAssets = (db: Db) =>
  db
    .delete(assets)
    .where(
      and(
        isNull(assets.connectionId),
        or(
          like(assets.appId, `${DEMO_PREFIX}%`),
          ...demoAssetsOf().map((asset) => and(eq(assets.kind, asset.kind), eq(assets.externalId, asset.externalId))),
        ),
      ),
    )

/** Removes the demo apps and, through ON DELETE CASCADE, everything recorded for them. */
export async function clearDemo(db: Db) {
  await deleteDemoAssets(db)
  const removed = await db
    .delete(apps)
    .where(like(apps.id, `${DEMO_PREFIX}%`))
    .returning({ id: apps.id })
  return { apps: removed.length }
}

/**
 * Replaces the demo apps with their assets, metrics, posts and reviews. Real apps (ids without the
 * prefix) are untouched.
 */
export async function seedDemo(db: Db, options: DemoOptions) {
  const data = generateDemoData(options)
  await db.transaction(async (tx) => {
    // Metrics and posts go with the apps through ON DELETE CASCADE; demo assets first, since
    // removing an app only unlinks its assets.
    await deleteDemoAssets(tx as unknown as Db)
    await tx.delete(apps).where(like(apps.id, `${DEMO_PREFIX}%`))
    await tx.insert(apps).values(data.apps)
    await tx.insert(assets).values(data.assets).onConflictDoNothing()
    await upsertMetrics(tx as unknown as Db, data.metrics)
    for (let i = 0; i < data.posts.length; i += 500) {
      await tx.insert(posts).values(data.posts.slice(i, i + 500))
    }
    await saveReviews(tx as unknown as Db, generateDemoReviews(options))
  })
  return { apps: data.apps.length, metrics: data.metrics.length, posts: data.posts.length }
}
