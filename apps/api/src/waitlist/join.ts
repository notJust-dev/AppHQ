import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { Db } from '../db/client.js'
import { waitlist } from '../db/schema.js'

export const joinWaitlistInput = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  source: z.string().trim().min(1).max(40).default('landing'),
})

/**
 * Adds an address to the waitlist. Signing up twice is not an error: the first sign-up's date
 * and source stay. Either way the row gets a fresh answer token, which the page uses to save the
 * follow-up questions. The page says the same thing whether the address is new, so it can't be
 * used to find out who signed up; `added` is for the API's own logs.
 */
export async function joinWaitlist(
  db: Db,
  input: z.input<typeof joinWaitlistInput>,
): Promise<{ added: boolean; answerToken: string }> {
  const { email, source } = joinWaitlistInput.parse(input)
  const answerToken = randomUUID()
  const existing = await db.select({ id: waitlist.id }).from(waitlist).where(eq(waitlist.email, email))
  await db
    .insert(waitlist)
    .values({ email, source, answerToken })
    .onConflictDoUpdate({ target: waitlist.email, set: { answerToken } })
  return { added: existing.length === 0, answerToken }
}

/**
 * The follow-up questions. Every one is optional; the keys are what the database stores. The
 * answers are one JSON column, so a question can be added here without a migration.
 */
export const WAITLIST_OPTIONS = {
  appCount: ['none_yet', '1', '2_3', '4_10', '11_plus'],
  mrr: ['0', 'under_1k', '1k_10k', '10k_50k', '50k_plus', 'rather_not_say'],
  monetisation: ['revenuecat', 'superwall', 'adapty', 'qonversion', 'stripe', 'in_house', 'other'],
  analytics: ['firebase', 'mixpanel', 'amplitude', 'posthog', 'appsflyer', 'adjust', 'other'],
  stores: ['app_store', 'google_play'],
  platforms: ['tiktok', 'instagram', 'threads', 'youtube', 'x', 'facebook', 'reddit', 'linkedin', 'paid_ads', 'ugc', 'aso', 'seo', 'other'],
  teamSize: ['solo', '2_5', '6_plus'],
  wouldPay: ['10_30', '30_100', '100_plus', 'not_sure'],
} as const

// Each answer may be left out (unchanged) or null (cleared). An empty list or text clears it too.
const one = <T extends readonly [string, ...string[]]>(values: T) => z.enum(values).nullable().optional()
const many = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .array(z.enum(values))
    .max(values.length)
    .transform((list) => (list.length === 0 ? null : [...new Set(list)]))
    .nullable()
    .optional()
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional()

/** A change to the follow-up answers: only the questions that changed. */
export const waitlistAnswers = z.object({
  appCount: one(WAITLIST_OPTIONS.appCount),
  mrr: one(WAITLIST_OPTIONS.mrr),
  /** Subscription and payment tools, to see which integrations matter most. */
  monetisation: many(WAITLIST_OPTIONS.monetisation),
  /** Analytics and attribution tools, for the same reason. */
  analytics: many(WAITLIST_OPTIONS.analytics),
  stores: many(WAITLIST_OPTIONS.stores),
  platforms: many(WAITLIST_OPTIONS.platforms),
  teamSize: one(WAITLIST_OPTIONS.teamSize),
  wouldPay: one(WAITLIST_OPTIONS.wouldPay),
  /** What they use today to follow their numbers. */
  currentTools: text(500),
  /** Anything else: what would make it worth it. */
  note: text(1000),
})
export type WaitlistAnswers = z.infer<typeof waitlistAnswers>

export const answerWaitlistInput = z.object({
  answerToken: z.uuid(),
  answers: waitlistAnswers,
  /** Set when they reach the end of the questions. */
  completed: z.boolean().optional(),
})

/**
 * Saves a change to the follow-up answers of the sign-up the token belongs to. The page sends
 * each answer as it is given, so whatever someone answered is kept even if they never finish:
 * the change is merged into what is saved, and a null answer is removed. Returns false for a
 * token that matches nothing (a later sign-up with the same address replaced it).
 */
export async function answerWaitlist(db: Db, input: z.input<typeof answerWaitlistInput>): Promise<boolean> {
  const { answerToken, answers, completed } = answerWaitlistInput.parse(input)
  const now = new Date()
  const rows = await db
    .update(waitlist)
    .set({
      answers: sql`jsonb_strip_nulls(coalesce(${waitlist.answers}, '{}'::jsonb) || ${JSON.stringify(answers)}::jsonb)`,
      answeredAt: now,
      ...(completed ? { answersCompletedAt: now } : {}),
    })
    .where(eq(waitlist.answerToken, answerToken))
    .returning({ id: waitlist.id })
  return rows.length > 0
}
