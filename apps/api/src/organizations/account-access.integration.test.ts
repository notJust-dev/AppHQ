import { randomUUID } from 'node:crypto'
import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { eq, inArray, sql as raw } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, type Db } from '../db/client.js'
import { runMigrations } from '../db/migrate.js'
import { account, apps, invitation, member, organization, session, user, verification } from '../db/schema.js'
import { TOKEN, buildTestApp } from '../test/auth.js'
import { testDatabaseUrl } from '../test/database.js'
import { testOrganization } from '../test/organizations.js'
import { ACCESS_HEADER, DASHBOARD_ACCESS } from '../trpc/init.js'
import type { Scope } from './scope.js'
import { TENANT_ROLE, tenancyOf } from './tenancy.js'

// Runs only when a database is provided: TEST_DATABASE_URL=postgres://.../appdashboard_test
const url = testDatabaseUrl()

/**
 * Accounts opening the dashboard, against a real database, with the dashboard password switched
 * off on the API as the hosted version runs it. Names, addresses and slugs are invented.
 */
describe.skipIf(!url)('Account access to the dashboard, against a real database', () => {
  const { db, sql } = createDb(url ?? 'postgres://unused')
  const tag = randomUUID().slice(0, 8)
  const email = (name: string) => `${name}-${tag}@example.com`
  const people = ['member-a', 'member-b', 'requested', 'unverified', 'alone'].map(email)

  /** Who and where each unit of work ran, read inside it after its work. */
  const units: { who: string; organization: string }[] = []
  /** The database the API gets: the same one, but every unit of work also says who it ran as. */
  const watched = new Proxy(db, {
    get(target, property, receiver) {
      if (property !== 'transaction') return Reflect.get(target, property, receiver)
      return (work: (tx: Parameters<Parameters<Db['transaction']>[0]>[0]) => Promise<unknown>) =>
        target.transaction(async (tx) => {
          const result = await work(tx)
          const [unit] = await tx.execute<{ who: string; organization: string }>(
            raw`select current_user as who, coalesce(current_setting('app.organization_id', true), '') as organization`,
          )
          if (unit) units.push(unit)
          return result
        })
    },
  }) as Db

  let built: Awaited<ReturnType<typeof buildTestApp>>
  let a: Scope
  let b: Scope
  let appOfA: string
  let appOfB: string
  const cookies: Record<string, string> = {}

  const call = (path: string, cookie: string, input?: unknown, extra: Record<string, string> = {}) => {
    const headers = { authorization: `Bearer ${TOKEN}`, cookie, ...extra }
    const mutation = ['apps.rename', 'apps.remove'].includes(path)
    return mutation
      ? built.app.inject({ method: 'POST', url: `/trpc/${path}`, headers: { ...headers, 'content-type': 'application/json' }, payload: JSON.stringify(input) })
      : built.app.inject({ method: 'GET', url: `/trpc/${path}${input === undefined ? '' : `?input=${encodeURIComponent(JSON.stringify(input))}`}`, headers })
  }
  const data = (res: { json(): unknown }) => (res.json() as { result: { data: unknown } }).result.data

  beforeAll(async () => {
    await runMigrations({ db, sql })
    // Set up once here, so the units recorded below are only the requests'.
    await tenancyOf(watched)
    built = await buildTestApp({
      db: watched,
      allowDashboardPassword: false,
      database: drizzleAdapter(db, {
        provider: 'pg',
        schema: { user, session, account, verification, organization, member, invitation },
      }),
    })
    a = await testOrganization(db, `access-a-${tag}`)
    b = await testOrganization(db, `access-b-${tag}`)
    appOfA = (await a.run((tx) => tx.insert(apps).values({ organizationId: a.organizationId, name: 'Alpha app' }).returning({ id: apps.id })))[0]!.id
    appOfB = (await b.run((tx) => tx.insert(apps).values({ organizationId: b.organizationId, name: 'Beta app' }).returning({ id: apps.id })))[0]!.id

    const signUp = async (name: string, accessStatus: 'requested' | 'approved', memberOf: Scope | null) => {
      const signedIn = await built.signIn({ email: email(name), emailVerified: true })
      await db.update(user).set({ accessStatus }).where(eq(user.id, signedIn.userId!))
      if (memberOf) await db.insert(member).values({ organizationId: memberOf.organizationId, userId: signedIn.userId!, role: 'owner' })
      cookies[name] = signedIn.cookie
      return signedIn.userId!
    }
    await signUp('member-a', 'approved', a)
    await signUp('member-b', 'approved', b)
    await signUp('requested', 'requested', a)
    const unverified = await signUp('unverified', 'approved', a)
    await db.update(user).set({ emailVerified: false }).where(eq(user.id, unverified))
    await signUp('alone', 'approved', null)
  })

  afterAll(async () => {
    await built?.app.close()
    // Sessions, sign-in methods and memberships go with the user; apps with their organization.
    await db.delete(user).where(inArray(user.email, people))
    const made = [a, b].filter(Boolean).map((scope) => scope.organizationId)
    if (made.length > 0) {
      await db.delete(apps).where(inArray(apps.organizationId, made))
      await db.delete(organization).where(inArray(organization.id, made))
    }
    await sql.end()
  })

  it('an approved member works in its own organization, as the tenant role under row-level security', async () => {
    units.length = 0
    const listed = await call('apps.list', cookies['member-a']!)
    expect(listed.statusCode).toBe(200)
    expect((data(listed) as { id: string }[]).map((row) => row.id)).toEqual([appOfA])
    expect(units).toEqual([{ who: TENANT_ROLE, organization: a.organizationId }])

    const current = await call('organization.current', cookies['member-a']!)
    expect(data(current)).toEqual({ name: `Test access-a-${tag}`, via: 'account' })

    const listedB = await call('apps.list', cookies['member-b']!)
    expect((data(listedB) as { id: string }[]).map((row) => row.id)).toEqual([appOfB])
  })

  it("records the organization on the session, and the session can't move it elsewhere", async () => {
    const [mine] = await db.select({ userId: user.id }).from(user).where(eq(user.email, email('member-a')))
    const sessions = () => db.select({ active: session.activeOrganizationId }).from(session).where(eq(session.userId, mine!.userId))
    expect((await sessions()).map((row) => row.active)).toEqual([a.organizationId])

    // Even pointed at B, the session works in A, the only organization it belongs to.
    await db.update(session).set({ activeOrganizationId: b.organizationId }).where(eq(session.userId, mine!.userId))
    const listed = await call('apps.list', cookies['member-a']!)
    expect((data(listed) as { id: string }[]).map((row) => row.id)).toEqual([appOfA])
    expect((await sessions()).map((row) => row.active)).toEqual([a.organizationId])
  })

  it("a member of A can't reach B's app", async () => {
    expect((await call('apps.timeline', cookies['member-a']!, { appId: appOfB, from: '2026-10-01', to: '2026-10-31' })).statusCode).toBe(404)
    expect((await call('apps.rename', cookies['member-a']!, { appId: appOfB, name: 'Taken' })).statusCode).toBe(400)
    expect((await call('apps.remove', cookies['member-a']!, { appId: appOfB })).statusCode).toBe(400)
    const [still] = await b.run((tx) => tx.select({ name: apps.name }).from(apps).where(eq(apps.id, appOfB)))
    expect(still?.name).toBe('Beta app')
  })

  it.each(['requested', 'unverified', 'alone'])('refuses the %s account', async (name) => {
    expect((await call('apps.list', cookies[name]!)).statusCode).toBe(403)
    expect((await call('organization.current', cookies[name]!)).statusCode).toBe(403)
  })

  it('refuses the dashboard password statement, with this API set not to accept it', async () => {
    expect((await call('apps.list', '', undefined, { [ACCESS_HEADER]: DASHBOARD_ACCESS })).statusCode).toBe(403)
  })
})
