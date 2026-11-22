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

/** The portfolio. `id` is a short slug used in URLs and by the AI tools. */
export const apps = pgTable('apps', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  iconUrl: text('icon_url'),
  /** Numeric App Store id, used by App Store Connect reports. */
  iosAppId: text('ios_app_id'),
  iosBundleId: text('ios_bundle_id'),
  androidPackage: text('android_package'),
  revenuecatProjectId: text('revenuecat_project_id'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * Credentials that have to live in the database: OAuth tokens that rotate (TikTok, Instagram)
 * and per-project API keys pasted in Settings (RevenueCat). Token columns hold ciphertext.
 * Account-level static keys (App Store Connect, Google Play) stay in env variables.
 */
export const connections = pgTable(
  'connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: text('provider').notNull(),
    appId: text('app_id').references(() => apps.id, { onDelete: 'cascade' }),
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

export type App = typeof apps.$inferSelect
export type NewApp = typeof apps.$inferInsert
export type NewMetric = typeof metricDaily.$inferInsert
export type SyncRun = typeof syncRuns.$inferSelect
export type Connection = typeof connections.$inferSelect
export type Post = typeof posts.$inferSelect
export type NewPost = typeof posts.$inferInsert
