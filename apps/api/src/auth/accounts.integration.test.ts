import { randomUUID } from 'node:crypto'
import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '../db/client.js'
import { runMigrations } from '../db/migrate.js'
import { account, session, user, verification } from '../db/schema.js'
import { TOKEN, buildTestApp } from '../test/auth.js'
import { testDatabaseUrl } from '../test/database.js'
import { ACCESS_HEADER, DASHBOARD_ACCESS } from '../trpc/init.js'

// Runs only when a database is provided: TEST_DATABASE_URL=postgres://.../appdashboard_test
const url = testDatabaseUrl()

describe.skipIf(!url)('Accounts, against a real database', () => {
  const { db, sql } = createDb(url ?? 'postgres://unused')
  const email = `person-${randomUUID().slice(0, 8)}@example.com`
  let built: Awaited<ReturnType<typeof buildTestApp>>

  beforeAll(async () => {
    await runMigrations({ db, sql })
    built = await buildTestApp({
      db,
      database: drizzleAdapter(db, { provider: 'pg', schema: { user, session, account, verification } }),
    })
  })
  afterAll(async () => {
    await built?.app.close()
    // Sessions and sign-in methods go with the user.
    await db.delete(user).where(eq(user.email, email))
    await sql.end()
  })

  const call = (path: string, cookie: string, extra: Record<string, string> = {}) =>
    built.app.inject({
      method: path === 'account.requestAccess' ? 'POST' : 'GET',
      url: `/trpc/${path}`,
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', cookie, ...extra },
      ...(path === 'account.requestAccess' ? { payload: 'null' } : {}),
    })

  it('signs someone in and stores them with a UUID and no access', async () => {
    const { res, cookie, userId } = await built.signIn({ email, emailVerified: true, extra: { accessStatus: 'approved' } })
    expect(res.statusCode).toBe(200)
    expect(userId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)

    const [row] = await db.select().from(user).where(eq(user.email, email))
    expect(row).toMatchObject({ id: userId, emailVerified: true, accessStatus: null, accessRequestedAt: null })
    const sessions = await db.select().from(session).where(eq(session.userId, userId!))
    expect(sessions).toHaveLength(1)
    // The address is only for rate limits; the privacy page promises it is not stored.
    expect(sessions[0]).toMatchObject({ ipAddress: null, userAgent: null })
    const [method] = await db.select().from(account).where(eq(account.userId, userId!))
    expect(method?.providerId).toBe('google')

    expect((await call('account.get', cookie)).statusCode).toBe(200)
    // The account opens nothing on the dashboard.
    expect((await call('apps.list', cookie)).statusCode).toBe(403)
  })

  it('records a request once, and an approval stays an approval', async () => {
    const { cookie } = await built.signIn({ email, emailVerified: true })
    const first = await call('account.requestAccess', cookie)
    expect(first.statusCode).toBe(200)
    const [requested] = await db.select().from(user).where(eq(user.email, email))
    expect(requested?.accessStatus).toBe('requested')
    expect(requested?.accessRequestedAt).toBeInstanceOf(Date)

    await call('account.requestAccess', cookie)
    const [again] = await db.select().from(user).where(eq(user.email, email))
    expect(again?.accessRequestedAt).toEqual(requested?.accessRequestedAt)

    // Approval is done by hand in the database in this phase.
    await db.update(user).set({ accessStatus: 'approved' }).where(eq(user.email, email))
    await call('account.requestAccess', cookie)
    const [approved] = await db.select().from(user).where(eq(user.email, email))
    expect(approved?.accessStatus).toBe('approved')

    // Approved still opens nothing on the dashboard; only the dashboard password does.
    expect((await call('overview.get', cookie)).statusCode).toBe(403)
    expect((await call('apps.list', cookie, { [ACCESS_HEADER]: 'yes' })).statusCode).toBe(403)
    expect((await call('apps.list', '', { [ACCESS_HEADER]: DASHBOARD_ACCESS })).statusCode).toBe(200)
  })
})
