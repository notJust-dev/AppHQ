import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '../db/client.js'
import { runMigrations } from '../db/migrate.js'
import { waitlist } from '../db/schema.js'
import { testDatabaseUrl } from '../test/database.js'
import { answerWaitlist, joinWaitlist } from './join.js'

// Runs only when a database is provided: TEST_DATABASE_URL=postgres://.../appdashboard_test
const url = testDatabaseUrl()

describe.skipIf(!url)('Waitlist, against a real database', () => {
  const { db, sql } = createDb(url ?? 'postgres://unused')
  const email = `someone-${randomUUID().slice(0, 8)}@example.com`
  const rowsFor = () => db.select().from(waitlist).where(eq(waitlist.email, email))

  beforeAll(() => runMigrations({ db, sql }))
  afterAll(async () => {
    await db.delete(waitlist).where(eq(waitlist.email, email))
    await sql.end()
  })

  it('stores an address once, whatever its case', async () => {
    const first = await joinWaitlist(db, { email: `  ${email.toUpperCase()} ` })
    const second = await joinWaitlist(db, { email })
    expect(first.added).toBe(true)
    expect(second.added).toBe(false)
    expect(second.answerToken).not.toBe(first.answerToken)

    const rows = await rowsFor()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.source).toBe('landing')
  })

  it('rejects something that is not an address', async () => {
    await expect(joinWaitlist(db, { email: 'not-an-email' })).rejects.toThrow()
  })

  it('saves answers only with the latest token', async () => {
    const { answerToken: old } = await joinWaitlist(db, { email })
    const { answerToken } = await joinWaitlist(db, { email })

    expect(await answerWaitlist(db, { answerToken: old, answers: { appCount: '1' } })).toBe(false)
    expect(await answerWaitlist(db, { answerToken, answers: { appCount: '2_3' } })).toBe(true)
  })

  it('keeps each answer as it is given, so an unfinished form is not lost', async () => {
    const { answerToken } = await joinWaitlist(db, { email })
    const save = (answers: Parameters<typeof answerWaitlist>[1]['answers'], completed?: boolean) =>
      answerWaitlist(db, { answerToken, answers, completed })

    await save({ appCount: '2_3' })
    await save({ mrr: '1k_10k' })
    await save({ platforms: ['tiktok', 'tiktok', 'youtube'] })
    await save({ monetisation: ['revenuecat', 'superwall'] })
    await save({ analytics: ['posthog'] })
    await save({ note: ' hi ' })
    let [row] = await rowsFor()
    expect(row?.answers).toEqual({ appCount: '2_3', mrr: '1k_10k', platforms: ['tiktok', 'youtube'], monetisation: ['revenuecat', 'superwall'], analytics: ['posthog'], note: 'hi' })
    expect(row?.answeredAt).toBeInstanceOf(Date)
    expect(row?.answersCompletedAt).toBeNull()

    // Clearing: null, an empty list and empty text each remove the answer.
    await save({ mrr: null, platforms: [], monetisation: null, analytics: [], note: '  ' }, true)
    ;[row] = await rowsFor()
    expect(row?.answers).toEqual({ appCount: '2_3' })
    expect(row?.answersCompletedAt).toBeInstanceOf(Date)
  })

  it('rejects answers that are not on the list', async () => {
    const { answerToken } = await joinWaitlist(db, { email })
    await expect(answerWaitlist(db, { answerToken, answers: { mrr: 'a lot' as never } })).rejects.toThrow()
  })
})
