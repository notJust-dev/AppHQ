import { sql } from 'drizzle-orm'
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
 * Organizations, kept by Better Auth's organization plugin with its default names (see
 * src/auth/auth.ts). Every piece of data belongs to one: `organization_id` on each data table.
 *
 * Nobody can create, join or switch organizations through Better Auth: none of the plugin's
 * endpoints is reachable. The API makes them itself (src/organizations), and the dashboard
 * password works in one of them (src/organizations/dashboard.ts). Membership grants nothing yet.
 */
export const organization = pgTable('organization', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  logo: text('logo'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  metadata: text('metadata'),
})

/** Who belongs to an organization. A user may belong to several. */
export const member = pgTable(
  'member',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** 'owner' | 'admin' | 'member' */
    role: text('role').default('member').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('member_organization_user_idx').on(t.organizationId, t.userId),
    index('member_userId_idx').on(t.userId),
  ],
)

/** Invitations to an organization. The table is the plugin's; nothing uses it yet. */
export const invitation = pgTable(
  'invitation',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: text('role'),
    status: text('status').default('pending').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    inviterId: uuid('inviter_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (t) => [
    index('invitation_organizationId_idx').on(t.organizationId),
    index('invitation_email_idx').on(t.email),
  ],
)

/** The organization a row belongs to. Deleting an organization that still holds data fails. */
const organizationId = () =>
  uuid('organization_id')
    .notNull()
    .references(() => organization.id)

/**
 * The portfolio. `id` is a uuid, also used in the dashboard's addresses: it says nothing about
 * the app. What feeds an app (its store listings, RevenueCat project, social accounts) is in
 * `assets`.
 *
 * An organization has at most one row of `kind` 'portfolio': it holds accounts that promote
 * several apps, such as a personal build-in-public account, so their numbers count toward the
 * portfolio's totals without landing in any single app's funnel.
 */
export const apps = pgTable(
  'apps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: organizationId(),
    name: text('name').notNull(),
    iconUrl: text('icon_url'),
    /** 'app' | 'portfolio' */
    kind: text('kind').notNull().default('app'),
    isActive: boolean('is_active').notNull().default(true),
    /** Generated demo data (see src/seed/demo.ts), removed in bulk. */
    demo: boolean('demo').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('apps_org_idx').on(t.organizationId),
    uniqueIndex('apps_org_portfolio_idx').on(t.organizationId).where(sql`${t.kind} = 'portfolio'`),
  ],
)

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
    organizationId: organizationId(),
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
  (t) => [uniqueIndex('connections_org_provider_account_idx').on(t.organizationId, t.provider, t.externalAccountId)],
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
    organizationId: organizationId(),
    /** 'ios_app' | 'android_app' | 'revenuecat_project' | 'facebook_page' | 'instagram_account' | 'tiktok_account' */
    kind: text('kind').notNull(),
    /** Apple ID, package name, RevenueCat project id, Page id, Instagram id, TikTok open_id. */
    externalId: text('external_id').notNull(),
    name: text('name').notNull(),
    appId: uuid('app_id').references(() => apps.id, { onDelete: 'set null' }),
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
    uniqueIndex('assets_org_kind_external_idx').on(t.organizationId, t.kind, t.externalId),
    index('assets_org_app_idx').on(t.organizationId, t.appId),
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
    organizationId: organizationId(),
    appId: uuid('app_id')
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
    primaryKey({ columns: [t.organizationId, t.appId, t.date, t.source, t.metric, t.dimension] }),
    index('metric_daily_org_date_idx').on(t.organizationId, t.date),
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
    organizationId: organizationId(),
    platform: text('platform').notNull(),
    externalId: text('external_id').notNull(),
    appId: uuid('app_id')
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
    uniqueIndex('posts_org_platform_external_idx').on(t.organizationId, t.platform, t.externalId),
    index('posts_org_app_published_idx').on(t.organizationId, t.appId, t.publishedAt),
  ],
)

/**
 * A post's lifetime totals as last read on each UTC day. Platforms such as TikTok only report
 * totals, so daily views are the difference between consecutive days. A snapshot is in its post's
 * organization.
 */
export const postSnapshots = pgTable(
  'post_snapshots',
  {
    organizationId: organizationId(),
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
    organizationId: organizationId(),
    appId: uuid('app_id')
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
    uniqueIndex('reviews_org_store_external_idx').on(t.organizationId, t.store, t.externalId),
    index('reviews_org_app_created_idx').on(t.organizationId, t.appId, t.createdAt),
    index('reviews_org_created_idx').on(t.organizationId, t.createdAt),
  ],
)

/** One row per connector run, so failures are visible in the dashboard and to the bot. */
export const syncRuns = pgTable(
  'sync_runs',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    organizationId: organizationId(),
    source: text('source').notNull(),
    appId: uuid('app_id').references(() => apps.id, { onDelete: 'cascade' }),
    /** 'running' | 'ok' | 'error' */
    status: text('status').notNull(),
    rangeFrom: date('range_from', { mode: 'string' }),
    rangeTo: date('range_to', { mode: 'string' }),
    rowsWritten: integer('rows_written').notNull().default(0),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [index('sync_runs_org_source_started_idx').on(t.organizationId, t.source, t.startedAt)],
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

/**
 * Accounts, kept by Better Auth (see src/auth/auth.ts). The table and column names are Better
 * Auth's defaults, so its plugins can be added later with theirs. Ids are UUIDs made by Postgres.
 *
 * People sign in with Google or GitHub and can ask for access. An account does not open the
 * dashboard: that still takes the dashboard password.
 */
export const user = pgTable('user', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').default(false).notNull(),
  image: text('image'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
  /**
   * Null, 'requested' or 'approved'. Written only by the API (people cannot set it through
   * Better Auth) and, for approval, by hand in the database. It grants nothing yet.
   */
  accessStatus: text('access_status'),
  /** When they asked for access. */
  accessRequestedAt: timestamp('access_requested_at', { withTimezone: true }),
})

export const session = pgTable(
  'session',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    token: text('token').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .$onUpdate(() => new Date())
      .notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** The organization plugin's field. Nothing sets it yet, and it grants nothing. */
    activeOrganizationId: uuid('active_organization_id'),
  },
  (t) => [index('session_userId_idx').on(t.userId)],
)

/** How a user signs in: one row per Google or GitHub identity. Provider tokens are encrypted. */
export const account = pgTable(
  'account',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [index('account_userId_idx').on(t.userId)],
)

export const verification = pgTable(
  'verification',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [index('verification_identifier_idx').on(t.identifier)],
)

export type App = typeof apps.$inferSelect
export type NewApp = typeof apps.$inferInsert
/** A metric row as a connector reads it; `upsertMetrics` adds the organization. */
export type NewMetric = Omit<typeof metricDaily.$inferInsert, 'organizationId'>
export type SyncRun = typeof syncRuns.$inferSelect
export type Connection = typeof connections.$inferSelect
export type Post = typeof posts.$inferSelect
export type NewPost = typeof posts.$inferInsert
export type Asset = typeof assets.$inferSelect
export type Review = typeof reviews.$inferSelect
export type NewReview = typeof reviews.$inferInsert
export type WaitlistEntry = typeof waitlist.$inferSelect
export type Organization = typeof organization.$inferSelect
