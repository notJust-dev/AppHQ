import { randomUUID } from 'node:crypto'
import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '../db/client.js'
import { runMigrations } from '../db/migrate.js'
import { account, invitation, member, organization, session, user, verification } from '../db/schema.js'
import { CONFIG, TOKEN, buildTestApp } from '../test/auth.js'
import { testDatabaseUrl } from '../test/database.js'
import { CODE_ATTEMPTS, codeIdentifier } from './email.js'

// Runs only when a database is provided: TEST_DATABASE_URL=postgres://.../appdashboard_test
const url = testDatabaseUrl()

const PASSWORD = 'a-test-password-of-enough-length'
const OTHER_PASSWORD = 'another-test-password-long-enough'

describe.skipIf(!url)('Email sign-up, against a real database', () => {
  const { db, sql } = createDb(url ?? 'postgres://unused')
  const tag = randomUUID().slice(0, 8)
  const email = `signer-${tag}@example.com`
  const guessed = `guessed-${tag}@example.com`
  const raced = `raced-${tag}@example.com`
  let built: Awaited<ReturnType<typeof buildTestApp>>

  beforeAll(async () => {
    await runMigrations({ db, sql })
    built = await buildTestApp({
      db,
      database: drizzleAdapter(db, {
        provider: 'pg',
        schema: { user, session, account, verification, organization, member, invitation },
      }),
    })
  })
  afterAll(async () => {
    await built?.app.close()
    // Sessions and sign-in methods go with the user.
    await db.delete(user).where(inArray(user.email, [email, guessed, raced]))
    await db.delete(verification).where(inArray(verification.identifier, [email, guessed, raced].map((address) => codeIdentifier(CONFIG.secret, address))))
    await sql.end()
  })

  const codeRows = (address: string) => db.select().from(verification).where(eq(verification.identifier, codeIdentifier(CONFIG.secret, address)))

  it('keeps the code out of the database, makes the account on confirmation and signs it in', async () => {
    expect((await built.post('/email-sign-up/send-code', { email })).statusCode).toBe(200)
    const code = built.lastCode(email)
    const [row] = await codeRows(email)
    expect(row?.value).toMatch(/^[0-9a-f]{64}:0$/)
    expect(row?.value).not.toContain(code)
    // Nor is the address, before it is confirmed.
    expect(row?.identifier).toMatch(/^sign-up-code:[0-9a-f]{64}$/)
    expect(await sql`select 1 from verification where identifier like ${'%' + email + '%'} or value like ${'%' + email + '%'}`).toHaveLength(0)
    expect(await db.select().from(user).where(eq(user.email, email))).toHaveLength(0)

    const res = await built.post('/email-sign-up/confirm', { email, code, password: PASSWORD })
    expect(res.statusCode).toBe(200)
    const [person] = await db.select().from(user).where(eq(user.email, email))
    expect(person).toMatchObject({ emailVerified: true, name: '', accessStatus: null })
    expect(person?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    const methods = await db.select().from(account).where(eq(account.userId, person!.id))
    expect(methods.map((row) => row.providerId)).toEqual(['credential'])
    expect(methods[0]?.password).not.toContain(PASSWORD)
    const sessions = await db.select().from(session).where(eq(session.userId, person!.id))
    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toMatchObject({ ipAddress: null, userAgent: null })
    // The code is spent.
    expect(await codeRows(email)).toHaveLength(0)
  })

  it('signs in, and a reset replaces the password and ends every session', async () => {
    const signedIn = await built.post('/sign-in/email', { email, password: PASSWORD })
    expect(signedIn.statusCode).toBe(200)
    const [person] = await db.select().from(user).where(eq(user.email, email))
    expect((await db.select().from(session).where(eq(session.userId, person!.id))).length).toBeGreaterThanOrEqual(2)

    expect((await built.post('/request-password-reset', { email })).statusCode).toBe(200)
    const token = decodeURIComponent(built.mailTo(email).at(-1)!.text.match(/#token=(\S+)/)![1]!)
    expect((await built.post('/reset-password', { token, newPassword: OTHER_PASSWORD })).statusCode).toBe(200)

    expect(await db.select().from(session).where(eq(session.userId, person!.id))).toHaveLength(0)
    expect((await built.post('/sign-in/email', { email, password: PASSWORD })).statusCode).toBe(401)
    expect((await built.post('/sign-in/email', { email, password: OTHER_PASSWORD })).statusCode).toBe(200)
    // The link is spent too.
    expect((await built.post('/reset-password', { token, newPassword: PASSWORD })).statusCode).toBe(400)
  })

  it('counts wrong codes in the database and spends the code after too many', async () => {
    await built.post('/email-sign-up/send-code', { email: guessed })
    const code = built.lastCode(guessed)
    const wrong = String((Number(code) + 1) % 1_000_000).padStart(6, '0')

    expect((await built.post('/email-sign-up/confirm', { email: guessed, code: wrong, password: PASSWORD })).statusCode).toBe(400)
    expect((await codeRows(guessed))[0]?.value).toMatch(/:1$/)
    for (let i = 1; i < CODE_ATTEMPTS; i++) await built.post('/email-sign-up/confirm', { email: guessed, code: wrong, password: PASSWORD })
    expect(await codeRows(guessed)).toHaveLength(0)

    expect((await built.post('/email-sign-up/confirm', { email: guessed, code, password: PASSWORD })).statusCode).toBe(400)
    expect(await db.select().from(user).where(eq(user.email, guessed))).toHaveLength(0)
  })

  it('lets at most the allowed number of guesses through when many arrive at once', async () => {
    await built.post('/email-sign-up/send-code', { email: raced })
    const code = built.lastCode(raced)
    const guesses = Array.from({ length: 40 }, (_, i) => String((Number(code) + 1 + i) % 1_000_000).padStart(6, '0'))
    const answers = await Promise.all(
      guesses.map((guess) =>
        built.app.inject({
          method: 'POST',
          url: '/api/auth/email-sign-up/confirm',
          headers: { authorization: `Bearer ${TOKEN}`, origin: 'https://apphq.example.com', 'content-type': 'application/json' },
          payload: JSON.stringify({ email: raced, code: guess, password: PASSWORD }),
        }),
      ),
    )
    expect(answers.every((res) => res.statusCode !== 200)).toBe(true)
    // The code did not survive forty guesses, so the right one no longer works.
    expect((await built.post('/email-sign-up/confirm', { email: raced, code, password: PASSWORD })).statusCode).toBe(400)
    expect(await db.select().from(user).where(eq(user.email, raced))).toHaveLength(0)
  })
})
