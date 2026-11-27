import { randomUUID } from 'node:crypto'
import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '../db/client.js'
import { runMigrations } from '../db/migrate.js'
import { account, apps, invitation, member, organization, session, user, verification } from '../db/schema.js'
import { TOKEN, buildTestApp } from '../test/auth.js'
import { testDatabaseUrl } from '../test/database.js'
import { testOrganization } from '../test/organizations.js'
import type { Scope } from './scope.js'

// Runs only when a database is provided: TEST_DATABASE_URL=postgres://.../appdashboard_test
const url = testDatabaseUrl()

/**
 * Inviting, joining and removing, on the real tables: the plugin writes the `invitation` and
 * `member` rows through the Drizzle adapter, and the person invited then reads their new
 * organization's apps, and only those. Names, addresses and slugs are invented.
 */
describe.skipIf(!url)('Members, against a real database', () => {
  const { db, sql } = createDb(url ?? 'postgres://unused')
  const tag = randomUUID().slice(0, 8)
  const email = (name: string) => `${name}-${tag}@example.com`
  const people = ['owner', 'invited', 'other-owner'].map(email)
  let built: Awaited<ReturnType<typeof buildTestApp>>
  let a: Scope
  let b: Scope
  let appOfA: string
  const cookies: Record<string, string> = {}

  const call = (path: string, cookie: string, input?: unknown) => {
    const headers = { authorization: `Bearer ${TOKEN}`, cookie }
    return ['members.list', 'apps.list', 'account.get', 'organization.current'].includes(path)
      ? built.app.inject({ method: 'GET', url: `/trpc/${path}`, headers })
      : built.app.inject({ method: 'POST', url: `/trpc/${path}`, headers: { ...headers, 'content-type': 'application/json' }, payload: JSON.stringify(input ?? null) })
  }
  const data = <T>(res: { json(): unknown }) => (res.json() as { result: { data: T } }).result.data

  beforeAll(async () => {
    await runMigrations({ db, sql })
    built = await buildTestApp({
      db,
      allowDashboardPassword: false,
      database: drizzleAdapter(db, { provider: 'pg', schema: { user, session, account, verification, organization, member, invitation } }),
    })
    a = await testOrganization(db, `members-a-${tag}`)
    b = await testOrganization(db, `members-b-${tag}`)
    appOfA = (await a.run((tx) => tx.insert(apps).values({ organizationId: a.organizationId, name: 'Alpha app' }).returning({ id: apps.id })))[0]!.id
    await b.run((tx) => tx.insert(apps).values({ organizationId: b.organizationId, name: 'Beta app' }))

    for (const [name, scope] of [['owner', a], ['other-owner', b]] as const) {
      const signedIn = await built.signIn({ email: email(name), emailVerified: true })
      await db.insert(member).values({ organizationId: scope.organizationId, userId: signedIn.userId!, role: 'owner' })
      cookies[name] = signedIn.cookie
    }
  })

  afterAll(async () => {
    await built?.app.close()
    await db.delete(user).where(inArray(user.email, people))
    const made = [a, b].filter(Boolean).map((scope) => scope.organizationId)
    if (made.length > 0) {
      await db.delete(apps).where(inArray(apps.organizationId, made))
      // Invitations and memberships go with the organization.
      await db.delete(organization).where(inArray(organization.id, made))
    }
    await sql.end()
  })

  it('invites an address into the invitation table', async () => {
    const res = await call('members.invite', cookies.owner!, { email: email('invited'), role: 'member' })
    expect(res.statusCode).toBe(200)
    const rows = await db.select().from(invitation).where(eq(invitation.organizationId, a.organizationId))
    expect(rows.map((row) => [row.email, row.role, row.status])).toEqual([[email('invited'), 'member', 'pending']])
    expect(built.mailTo(email('invited'))).toHaveLength(1)
  })

  it("another organization's owner can't cancel it", async () => {
    const [row] = await db.select({ id: invitation.id }).from(invitation).where(eq(invitation.organizationId, a.organizationId))
    expect((await call('members.cancelInvitation', cookies['other-owner']!, { invitationId: row!.id })).statusCode).toBe(404)
    const [still] = await db.select({ status: invitation.status }).from(invitation).where(eq(invitation.id, row!.id))
    expect(still?.status).toBe('pending')
  })

  it('the person invited signs in, joins, and sees that organization only', async () => {
    const signedIn = await built.signIn({ email: email('invited'), emailVerified: true })
    cookies.invited = signedIn.cookie
    expect((await call('apps.list', signedIn.cookie)).statusCode).toBe(403)

    expect((await call('account.get', signedIn.cookie)).statusCode).toBe(200)
    const listed = await call('apps.list', signedIn.cookie)
    expect(listed.statusCode).toBe(200)
    expect(data<{ id: string }[]>(listed).map((row) => row.id)).toEqual([appOfA])
    expect(data<{ name: string }>(await call('organization.current', signedIn.cookie)).name).toBe(`Test members-a-${tag}`)

    const [joined] = await db
      .select({ role: member.role })
      .from(member)
      .where(and(eq(member.organizationId, a.organizationId), eq(member.userId, signedIn.userId!)))
    expect(joined?.role).toBe('member')
    const [accepted] = await db.select({ status: invitation.status }).from(invitation).where(eq(invitation.organizationId, a.organizationId))
    expect(accepted?.status).toBe('accepted')
  })

  it('the owner changes their role, then removes them, and they are out', async () => {
    const members = data<{ members: { id: string; email: string }[] }>(await call('members.list', cookies.owner!)).members
    const invited = members.find((row) => row.email === email('invited'))!
    expect((await call('members.setRole', cookies.owner!, { memberId: invited.id, role: 'admin' })).statusCode).toBe(200)
    const [promoted] = await db.select({ role: member.role }).from(member).where(eq(member.id, invited.id))
    expect(promoted?.role).toBe('admin')

    expect((await call('members.remove', cookies['other-owner']!, { memberId: invited.id })).statusCode).toBe(404)
    expect((await call('members.remove', cookies.owner!, { memberId: invited.id })).statusCode).toBe(200)
    expect(await db.select().from(member).where(eq(member.id, invited.id))).toEqual([])
    expect((await call('apps.list', cookies.invited!)).statusCode).toBe(403)
  })
})
