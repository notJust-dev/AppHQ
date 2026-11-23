import {
  bigint,
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

/**
 * The portfolio. `id` is a short slug used in URLs and by the AI tools. What feeds an app (its
 * store listings, RevenueCat project, social accounts) is in `assets`.
 *
 * One row has `kind` 'portfolio' (id `portfolio`): it holds accounts that promote several apps,
 * such as a personal build-in-public account, so their numbers count toward the portfolio's
 * totals without landing in any single app's funnel.
 */
export const apps = pgTable('apps', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  iconUrl: text('icon_url'),
  /** 'app' | 'portfolio' */
  kind: text('kind').notNull().default('app'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * Credentials: one row per signed-in account or key, never tied to an app. App Store Connect and
 * Google Play keys, RevenueCat project keys, and OAuth tokens (TikTok accounts; Facebook Pages
 * and Instagram accounts, each with its own token). Token columns hold ciphertext. What an
 * account gives access to, and which app it belongs to, is in `assets`.
 */
export const connections = pgTable(
  'connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: text('provider').notNull(),
    externalAccountId: text('external_account_id'),
    displayName: text('display_name'),
    accessTokenEnc: text('access_token_enc'),
    refreshTokenEnc: text('refresh_token_enc'),
    /** When the access token stops working. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    /** When the refresh token stops working, so the account has to be connected again. */
    refreshExpiresAt: timestamp('refresh_expires_at', { withTimezone: true }),
    scopes: text('scopes'),
    /** What the source told us that is not secret, e.g. the Google Play packages it found. */
    details: jsonb('details'),
    /** 'ok' | 'needs_reauth' | 'error' */
    status: text('status').notNull().default('ok'),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('connections_provider_account_idx').on(t.provider, t.externalAccountId)],
)

/**
 * What the connected accounts give access to: iOS apps, Android apps, RevenueCat projects,
 * Facebook Pages, Instagram accounts, TikTok accounts. Each belongs to one app (or to the
 * portfolio), or to none yet; `ignored` marks one that should stop asking for a decision.
 * An app has at most one iOS app, one Android app and one RevenueCat project, and any number of
 * social accounts.
 */
export const assets = pgTable(
  'assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** 'ios_app' | 'android_app' | 'revenuecat_project' | 'facebook_page' | 'instagram_account' | 'tiktok_account' */
    kind: text('kind').notNull(),
    /** Apple ID, package name, RevenueCat project id, Page id, Instagram id, TikTok open_id. */
    externalId: text('external_id').notNull(),
    name: text('name').notNull(),
    appId: text('app_id').references(() => apps.id, { onDelete: 'set null' }),
    /** The account it was found through, whose credentials read it. Null for demo assets. */
    connectionId: uuid('connection_id').references(() => connections.id, { onDelete: 'set null' }),
    ignored: boolean('ignored').notNull().default(false),
    /** A person chose where this goes, or that it goes nowhere; automatic linking leaves it alone. */
    decided: boolean('decided').notNull().default(false),
    /** Non-secret facts used for matching, e.g. an iOS app's bundle id. */
    details: jsonb('details'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('assets_kind_external_idx').on(t.kind, t.externalId),
    index('assets_app_idx').on(t.appId),
  ],
)

/**
 * The single fact table: one number per app, day, source and metric.
 * `dimension` is '' in v1 and leaves room for a breakdown such as country.
 * Dates are UTC calendar days as reported by each source.
 */
export const metricDaily = pgTable(
  'metric_daily',
  {
    appId: text('app_id')
      .notNull()
      .references(() => apps.id, { onDelete: 'cascade' }),
    date: date('date', { mode: 'string' }).notNull(),
    source: text('source').notNull(),
    metric: text('metric').notNull(),
    dimension: text('dimension').notNull().default(''),
    value: doublePrecision('value').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.appId, t.date, t.source, t.metric, t.dimension] }),
    index('metric_daily_date_idx').on(t.date),
  ],
)

/**
 * Social posts, with their latest lifetime totals. A post belongs to the app its account
 * promotes. The totals are overwritten on every sync; the history lives in `post_snapshots`.
 */
export const posts = pgTable(
  'posts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    platform: text('platform').notNull(),
    externalId: text('external_id').notNull(),
    appId: text('app_id')
      .notNull()
      .references(() => apps.id, { onDelete: 'cascade' }),
    connectionId: uuid('connection_id').references(() => connections.id, { onDelete: 'set null' }),
    url: text('url'),
    caption: text('caption'),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull(),
    durationSeconds: integer('duration_seconds'),
    views: bigint('views', { mode: 'number' }).notNull().default(0),
    likes: bigint('likes', { mode: 'number' }).notNull().default(0),
    comments: bigint('comments', { mode: 'number' }).notNull().default(0),
    shares: bigint('shares', { mode: 'number' }).notNull().default(0),
    /** The first sync that saw this post. */
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('posts_platform_external_idx').on(t.platform, t.externalId),
    index('posts_app_published_idx').on(t.appId, t.publishedAt),
  ],
)

/**
 * A post's lifetime totals as last read on each UTC day. Platforms such as TikTok only report
 * totals, so daily views are the difference between consecutive days.
 */
export const postSnapshots = pgTable(
  'post_snapshots',
  {
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    date: date('date', { mode: 'string' }).notNull(),
    views: bigint('views', { mode: 'number' }).notNull(),
    likes: bigint('likes', { mode: 'number' }).notNull(),
    comments: bigint('comments', { mode: 'number' }).notNull(),
    shares: bigint('shares', { mode: 'number' }).notNull(),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.postId, t.date] })],
)

/**
 * Written store reviews: App Store customer reviews and Google Play reviews with text. A review
 * belongs to the app its store listing feeds. `readAt` is the inbox's state: null is unread.
 * Reviews already a fortnight old when first imported arrive read, so connecting a store does
 * not bury the inbox under a year of history; an edited review becomes unread again.
 */
export const reviews = pgTable(
  'reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    appId: text('app_id')
      .notNull()
      .references(() => apps.id, { onDelete: 'cascade' }),
    /** 'app_store' | 'google_play' */
    store: text('store').notNull(),
    /** The store's review id; for a Play review without one, its package and submit time. */
    externalId: text('external_id').notNull(),
    rating: integer('rating').notNull(),
    title: text('title'),
    body: text('body'),
    author: text('author'),
    /** The App Store's territory (ISO 3166-1 alpha-3, e.g. USA). */
    territory: text('territory'),
    /** The language Google Play reports for the reviewer, e.g. en. */
    language: text('language'),
    appVersion: text('app_version'),
    device: text('device'),
    /** A link to the review in the store's console, when the store gives one. */
    url: text('url'),
    reply: text('reply'),
    repliedAt: timestamp('replied_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    readAt: timestamp('read_at', { withTimezone: true }),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('reviews_store_external_idx').on(t.store, t.externalId),
    index('reviews_app_created_idx').on(t.appId, t.createdAt),
    index('reviews_created_idx').on(t.createdAt),
  ],
)

/** One row per connector run, so failures are visible in the dashboard and to the bot. */
export const syncRuns = pgTable(
  'sync_runs',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    source: text('source').notNull(),
    appId: text('app_id').references(() => apps.id, { onDelete: 'cascade' }),
    /** 'running' | 'ok' | 'error' */
    status: text('status').notNull(),
    rangeFrom: date('range_from', { mode: 'string' }),
    rangeTo: date('range_to', { mode: 'string' }),
    rowsWritten: integer('rows_written').notNull().default(0),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [index('sync_runs_source_started_idx').on(t.source, t.startedAt)],
)

/**
 * People who asked to hear when AppHQ opens, from the public landing page. `email` is stored
 * lowercased, so one address signs up once.
 */
export const waitlist = pgTable('waitlist', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  email: text('email').notNull().unique(),
  /** Where the sign-up came from, e.g. 'landing'. */
  source: text('source').notNull().default('landing'),
  /**
   * Handed to the browser on sign-up, so the follow-up questions can be saved to this row without
   * revealing or trusting the address. A new sign-up with the same address replaces it.
   */
  answerToken: uuid('answer_token'),
  /** The optional follow-up questions (apps, MRR, platforms…); see `waitlistAnswers` in the API. */
  answers: jsonb('answers'),
  /** When an answer last changed; answers are saved one at a time as they are given. */
  answeredAt: timestamp('answered_at', { withTimezone: true }),
  /** When they reached the end of the questions, so unfinished ones can be told apart. */
  answersCompletedAt: timestamp('answers_completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export type App = typeof apps.$inferSelect
export type NewApp = typeof apps.$inferInsert
export type NewMetric = typeof metricDaily.$inferInsert
export type SyncRun = typeof syncRuns.$inferSelect
export type Connection = typeof connections.$inferSelect
export type Post = typeof posts.$inferSelect
export type NewPost = typeof posts.$inferInsert
export type Asset = typeof assets.$inferSelect
export type Review = typeof reviews.$inferSelect
export type NewReview = typeof reviews.$inferInsert
export type WaitlistEntry = typeof waitlist.$inferSelect
