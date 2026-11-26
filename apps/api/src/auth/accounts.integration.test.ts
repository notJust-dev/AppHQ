import { randomUUID } from 'node:crypto'
import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '../db/client.js'
import { runMigrations } from '../db/migrate.js'
import { account, apps, invitation, member, organization, session, user, verification } from '../db/schema.js'
import { autoOrganizationSlug } from '../organizations/auto.js'
import { DASHBOARD_ORGANIZATION_SLUG } from '../organizations/dashboard.js'
import { addOwner } from '../organizations/owner.js'
import { TOKEN, buildTestApp } from '../test/auth.js'
import { testDatabaseUrl } from '../test/database.js'
import { ACCESS_HEADER, DASHBOARD_ACCESS } from '../trpc/init.js'

// Runs only when a database is provided: TEST_DATABASE_URL=postgres://.../appdashboard_test
const url = testDatabaseUrl()

describe.skipIf(!url)('Accounts, against a real database', () => {
  const { db, sql } = createDb(url ?? 'postgres://unused')
  const email = `person-${randomUUID().slice(0, 8)}@example.com`
  const otherEmail = `other-${randomUUID().slice(0, 8)}@example.com`
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
    const people = await db.select({ id: user.id }).from(user).where(inArray(user.email, [email, otherEmail]))
    const slugs = people.map((person) => autoOrganizationSlug(person.id))
    if (slugs.length > 0) {
      const made = await db.select({ id: organization.id }).from(organization).where(inArray(organization.slug, slugs))
      if (made.length > 0) await db.delete(apps).where(inArray(apps.organizationId, made.map((row) => row.id)))
      await db.delete(organization).where(inArray(organization.slug, slugs))
    }
    // Sessions, sign-in methods and memberships go with the user.
    await db.delete(user).where(inArray(user.email, [email, otherEmail]))
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
    // Without approved access, the account opens nothing on the dashboard.
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

    // Approved, and seen approved, it has its own organization and opens the dashboard there.
    expect((await call('apps.list', cookie)).statusCode).toBe(200)
    expect((await call('apps.list', '', { [ACCESS_HEADER]: 'yes' })).statusCode).toBe(403)
    expect((await call('apps.list', '', { [ACCESS_HEADER]: DASHBOARD_ACCESS })).statusCode).toBe(200)
  })

  it('makes one organization for an approved account, owned by it, and opens the dashboard in it', async () => {
    const [person] = await db.select().from(user).where(eq(user.email, email))
    const { cookie } = await built.signIn({ email, emailVerified: true })
    await Promise.all([call('account.get', cookie), call('account.get', cookie)])

    const memberships = await db.select().from(member).where(eq(member.userId, person!.id))
    expect(memberships).toHaveLength(1)
    expect(memberships[0]?.role).toBe('owner')
    const [own] = await db.select().from(organization).where(eq(organization.id, memberships[0]!.organizationId))
    expect(own).toMatchObject({ name: 'Organization', slug: autoOrganizationSlug(person!.id) })
    expect(own?.id).toMatch(/^[0-9a-f-]{36}$/)
    // The README's SQL works out the same slug.
    const [inSql] = await sql<{ slug: string }[]>`
      select 'org-' || left(encode(sha256(id::text::bytea), 'hex'), 12) as slug from "user" where id = ${person!.id}
    `
    expect(inSql?.slug).toBe(own?.slug)

    // The dashboard opens in it, and it is empty.
    const listed = await call('apps.list', cookie)
    expect(listed.statusCode).toBe(200)
    expect(listed.json().result.data).toEqual([])
    const current = await call('organization.current', cookie)
    expect(current.json().result.data).toEqual({ name: 'Organization', via: 'account' })
  })

  it('add-owner makes the account an owner of the dashboard organization and removes its empty one', async () => {
    const [person] = await db.select().from(user).where(eq(user.email, email))
    const [dashboard] = await db.select().from(organization).where(eq(organization.slug, DASHBOARD_ORGANIZATION_SLUG))

    const result = await addOwner(db, { email: email.toUpperCase(), organizationId: dashboard!.id })
    expect(result).toEqual({ added: true, removedEmpty: true })
    const memberships = await db.select().from(member).where(eq(member.userId, person!.id))
    expect(memberships.map((row) => [row.organizationId, row.role])).toEqual([[dashboard!.id, 'owner']])
    expect(await db.select().from(organization).where(eq(organization.slug, autoOrganizationSlug(person!.id)))).toHaveLength(0)

    // Again: nothing changes, and being a member, the account gets no new organization.
    expect(await addOwner(db, { email, organizationId: dashboard!.id })).toEqual({ added: false, removedEmpty: false })
    const { cookie } = await built.signIn({ email, emailVerified: true })
    await call('account.get', cookie)
    expect(await db.select().from(member).where(eq(member.userId, person!.id))).toHaveLength(1)
    // The dashboard now opens in the dashboard organization, where the password works too.
    const current = await call('organization.current', cookie)
    expect(current.statusCode).toBe(200)
    expect(current.json().result.data).toEqual({ name: dashboard!.name, via: 'account' })
    await db.delete(member).where(and(eq(member.userId, person!.id), eq(member.organizationId, dashboard!.id)))
  })

  it('add-owner keeps an organization made on approval that holds data', async () => {
    const signedIn = await built.signIn({ email: otherEmail, emailVerified: true })
    await db.update(user).set({ accessStatus: 'approved' }).where(eq(user.email, otherEmail))
    await call('account.get', signedIn.cookie)
    const [own] = await db.select().from(organization).where(eq(organization.slug, autoOrganizationSlug(signedIn.userId!)))
    await db.insert(apps).values({ organizationId: own!.id, name: 'Kept app' })
    const [dashboard] = await db.select().from(organization).where(eq(organization.slug, DASHBOARD_ORGANIZATION_SLUG))

    expect(await addOwner(db, { email: otherEmail, organizationId: dashboard!.id })).toEqual({ added: true, removedEmpty: false })
    expect(await db.select().from(organization).where(eq(organization.id, own!.id))).toHaveLength(1)
    await db.delete(member).where(and(eq(member.userId, signedIn.userId!), eq(member.organizationId, dashboard!.id)))
  })

  it('add-owner needs an account that exists', async () => {
    const [dashboard] = await db.select().from(organization).where(eq(organization.slug, DASHBOARD_ORGANIZATION_SLUG))
    await expect(addOwner(db, { email: 'nobody@example.com', organizationId: dashboard!.id })).rejects.toThrow(/No account/)
  })
})
