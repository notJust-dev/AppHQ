import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TEST_DASHBOARD_ORGANIZATION, TOKEN, buildTestApp } from '../test/auth.js'
import { ACCESS_HEADER, DASHBOARD_ACCESS, type Access } from './init.js'
import { appRouter } from './router.js'

/**
 * Every procedure, and who may call it. Adding a procedure means adding it here: the first test
 * fails until it is, so nothing becomes reachable by accident. Anything not `dashboard` needs a
 * reason in its own comment.
 */
const EXPECTED: Record<string, Access> = {
  'apps.list': 'dashboard',
  'apps.timeline': 'dashboard',
  'apps.flow': 'dashboard',
  'apps.posts': 'dashboard',
  'apps.rename': 'dashboard',
  'apps.remove': 'dashboard',
  'apps.create': 'dashboard',
  'apps.connectRevenueCat': 'dashboard',
  'accounts.list': 'dashboard',
  'accounts.connectAppStore': 'dashboard',
  'tiktok.setup': 'dashboard',
  'tiktok.authorizeUrl': 'dashboard',
  'tiktok.connect': 'dashboard',
  'googlePlay.connect': 'dashboard',
  'meta.setup': 'dashboard',
  'meta.authorizeUrl': 'dashboard',
  'meta.connect': 'dashboard',
  'assets.list': 'dashboard',
  'assets.assign': 'dashboard',
  'assets.ignore': 'dashboard',
  'overview.get': 'dashboard',
  'performance.social': 'dashboard',
  'performance.store': 'dashboard',
  'performance.monetisation': 'dashboard',
  'performance.search': 'dashboard',
  'youtube.setup': 'dashboard',
  'youtube.authorizeUrl': 'dashboard',
  'youtube.connect': 'dashboard',
  'searchConsole.connect': 'dashboard',
  'searchConsole.top': 'dashboard',
  'reviews.list': 'dashboard',
  'reviews.summary': 'dashboard',
  'reviews.unreadCount': 'dashboard',
  'reviews.mark': 'dashboard',
  'sync.status': 'dashboard',
  'sync.run': 'dashboard',
  'demo.seed': 'dashboard',
  'demo.clear': 'dashboard',
  'organization.current': 'dashboard',
  'members.list': 'dashboard',
  'members.invite': 'dashboard',
  'members.cancelInvitation': 'dashboard',
  'members.remove': 'dashboard',
  'members.setRole': 'dashboard',
  // The landing page's waitlist form, for anyone.
  'waitlist.join': 'public',
  'waitlist.answer': 'public',
  // Which sign-in buttons to show; says nothing about anyone.
  'account.config': 'public',
  // The signed-in person's own account.
  'account.get': 'account',
  'account.requestAccess': 'account',
}

interface ProcedureDef {
  _def: { type: 'query' | 'mutation' | 'subscription'; meta?: { access?: Access } }
}
const procedures = appRouter._def.procedures as unknown as Record<string, ProcedureDef>
const paths = Object.keys(procedures).sort()
const dashboardPaths = paths.filter((path) => EXPECTED[path] === 'dashboard')

describe('every procedure is classified', () => {
  it('names exactly the procedures the router has', () => {
    expect(paths).toEqual(Object.keys(EXPECTED).sort())
  })

  it.each(paths)('%s has the expected access', (path) => {
    expect(procedures[path]?._def.meta?.access ?? 'dashboard').toBe(EXPECTED[path])
  })
})

/** Invented organization ids for the in-memory store. */
const ORGANIZATION_A = '00000000-0000-4000-8000-0000000000a1'
const ORGANIZATION_B = '00000000-0000-4000-8000-0000000000b2'

type Built = Awaited<ReturnType<typeof buildTestApp>>

/** Calls a procedure the way the dashboard server does, with the given extra headers. */
function caller(built: () => Built) {
  return (path: string, headers: Record<string, string>, input?: unknown) => {
    const type = procedures[path]!._def.type
    const base = { authorization: `Bearer ${TOKEN}`, ...headers }
    return type === 'query'
      ? built().app.inject({
          method: 'GET',
          url: `/trpc/${path}${input === undefined ? '' : `?input=${encodeURIComponent(JSON.stringify(input))}`}`,
          headers: base,
        })
      : built().app.inject({
          method: 'POST',
          url: `/trpc/${path}`,
          headers: { ...base, 'content-type': 'application/json' },
          payload: JSON.stringify(input ?? null),
        })
  }
}

/** Passed the guard and got an organization: whatever else went wrong, it was not a refusal. */
const passed = (statusCode: number) => ![401, 403].includes(statusCode)

describe('dashboard procedures', () => {
  let built: Built
  const call = caller(() => built)
  /** Verified, never asked. */
  let verified: string
  /** Verified, asked, not approved, and a member of A, as someone invited is. */
  let requested: string
  /** Approved, but a member of nothing. */
  let approvedAlone: string
  /** Approved and a member of A, but its address is no longer verified. */
  let unverified: string
  /** Approved, and a member of A. */
  let memberOfA: { cookie: string; userId: string }
  /** Approved, and a member of A and of B. */
  let memberOfBoth: { cookie: string; userId: string }
  /** Approved, and owner of the dashboard's own organization. */
  let ownsDashboard: string

  const join = (userId: string, organizationId: string, createdAt: Date) =>
    built.memory.member.push({ id: crypto.randomUUID(), organizationId, userId, role: 'owner', createdAt })
  const sessionsOf = (userId: string) => built.memory.session.filter((row) => row.userId === userId)
  const setActive = (userId: string, organizationId: string | null) => {
    for (const row of sessionsOf(userId)) row.activeOrganizationId = organizationId
  }

  beforeAll(async () => {
    built = await buildTestApp()
    const context = await built.auth.$context
    const person = async (email: string, accessStatus: 'requested' | 'approved' | null) => {
      const signedIn = await built.signIn({ email, emailVerified: true })
      if (accessStatus) await context.internalAdapter.updateUser(signedIn.userId!, { accessStatus })
      return { cookie: signedIn.cookie, userId: signedIn.userId! }
    }
    for (const [id, slug] of [[ORGANIZATION_A, 'a'], [ORGANIZATION_B, 'b'], [TEST_DASHBOARD_ORGANIZATION, 'default']] as const) {
      built.memory.organization.push({ id, name: `Organization ${slug}`, slug, createdAt: new Date() })
    }

    verified = (await person('verified@example.com', null)).cookie

    const asked = await person('requested@example.com', 'requested')
    requested = asked.cookie
    join(asked.userId, ORGANIZATION_A, new Date('2026-01-01'))

    approvedAlone = (await person('approved@example.com', 'approved')).cookie

    const lapsed = await person('unverified@example.com', 'approved')
    unverified = lapsed.cookie
    join(lapsed.userId, ORGANIZATION_A, new Date('2026-01-01'))
    await context.internalAdapter.updateUser(lapsed.userId, { emailVerified: false })

    memberOfA = await person('member-a@example.com', 'approved')
    join(memberOfA.userId, ORGANIZATION_A, new Date('2026-01-01'))

    memberOfBoth = await person('member-both@example.com', 'approved')
    join(memberOfBoth.userId, ORGANIZATION_B, new Date('2026-02-01'))
    join(memberOfBoth.userId, ORGANIZATION_A, new Date('2026-01-01'))

    const owner = await person('dashboard-owner@example.com', 'approved')
    ownsDashboard = owner.cookie
    join(owner.userId, TEST_DASHBOARD_ORGANIZATION, new Date('2026-01-01'))
  })
  afterAll(() => built.app.close())

  it('the sessions used below are real', async () => {
    for (const cookie of [verified, requested, approvedAlone, unverified, memberOfA.cookie, memberOfBoth.cookie, ownsDashboard]) {
      expect(cookie).toMatch(/better-auth\.session_token=/)
    }
    // A member gets no new organization from being seen approved.
    const res = await call('account.get', { cookie: memberOfA.cookie })
    expect(res.statusCode).toBe(200)
    expect(res.json().result.data.accessStatus).toBe('approved')
    expect(built.memory.member.filter((row) => row.userId === memberOfA.userId)).toHaveLength(1)
  })

  it.each(dashboardPaths)('%s refuses the internal token alone', async (path) => {
    expect((await call(path, {})).statusCode).toBe(403)
  })

  it.each(dashboardPaths)('%s refuses an account that never asked', async (path) => {
    expect((await call(path, { cookie: verified })).statusCode).toBe(403)
  })

  // Membership is what counts: approval gives an account an organization of its own, and an
  // invitation a membership of someone else's.
  it.each(dashboardPaths)('%s lets in a member whose access is only requested', async (path) => {
    expect(passed((await call(path, { cookie: requested }, 'not-an-object')).statusCode)).toBe(true)
  })

  it.each(dashboardPaths)('%s refuses an approved member whose address is not verified', async (path) => {
    expect((await call(path, { cookie: unverified })).statusCode).toBe(403)
  })

  it.each(dashboardPaths)('%s refuses an approved account that belongs to no organization', async (path) => {
    expect((await call(path, { cookie: approvedAlone })).statusCode).toBe(403)
  })

  it.each(dashboardPaths)('%s lets an approved member in', async (path) => {
    expect(passed((await call(path, { cookie: memberOfA.cookie }, 'not-an-object')).statusCode)).toBe(true)
  })

  it.each(['1', 'true', 'DASHBOARD', ' dashboard', 'dashboard, dashboard'])(
    'refuses an access header of %j',
    async (value) => {
      expect((await call('apps.list', { [ACCESS_HEADER]: value, cookie: verified })).statusCode).toBe(403)
    },
  )

  // With the statement the guard lets the call through: the input is wrong or the (absent)
  // database fails, but nothing says "forbidden".
  it.each(dashboardPaths)('%s passes the guard with the dashboard statement', async (path) => {
    const res = await call(path, { [ACCESS_HEADER]: DASHBOARD_ACCESS }, 'not-an-object')
    expect(passed(res.statusCode)).toBe(true)
  })

  describe('the organization an account works in', () => {
    it('is its only membership, recorded on the session', async () => {
      setActive(memberOfA.userId, null)
      expect(passed((await call('apps.list', { cookie: memberOfA.cookie })).statusCode)).toBe(true)
      expect(sessionsOf(memberOfA.userId).map((row) => row.activeOrganizationId)).toEqual([ORGANIZATION_A])
    })

    it('is the oldest membership when the session names none', async () => {
      setActive(memberOfBoth.userId, null)
      await call('apps.list', { cookie: memberOfBoth.cookie })
      expect(sessionsOf(memberOfBoth.userId).map((row) => row.activeOrganizationId)).toEqual([ORGANIZATION_A])
    })

    it("is the session's active organization while the account belongs to it", async () => {
      setActive(memberOfBoth.userId, ORGANIZATION_B)
      expect(passed((await call('apps.list', { cookie: memberOfBoth.cookie })).statusCode)).toBe(true)
      expect(sessionsOf(memberOfBoth.userId).map((row) => row.activeOrganizationId)).toEqual([ORGANIZATION_B])
    })

    it('is never one the account does not belong to, whatever the session says', async () => {
      setActive(memberOfA.userId, ORGANIZATION_B)
      expect(passed((await call('apps.list', { cookie: memberOfA.cookie })).statusCode)).toBe(true)
      expect(sessionsOf(memberOfA.userId).map((row) => row.activeOrganizationId)).toEqual([ORGANIZATION_A])
    })

    it('is refused once the last membership is gone', async () => {
      const kept = built.memory.member.filter((row) => row.userId !== memberOfA.userId)
      const removed = built.memory.member.filter((row) => row.userId === memberOfA.userId)
      built.memory.member.splice(0, built.memory.member.length, ...kept)
      expect((await call('apps.list', { cookie: memberOfA.cookie })).statusCode).toBe(403)
      built.memory.member.push(...removed)
    })

    it('can be the dashboard organization', async () => {
      expect(passed((await call('apps.list', { cookie: ownsDashboard })).statusCode)).toBe(true)
    })
  })
})

describe('with ALLOW_DASHBOARD_PASSWORD off', () => {
  let built: Built
  const call = caller(() => built)
  let member: string

  beforeAll(async () => {
    built = await buildTestApp({ allowDashboardPassword: false })
    const context = await built.auth.$context
    const signedIn = await built.signIn({ email: 'member@example.com', emailVerified: true })
    await context.internalAdapter.updateUser(signedIn.userId!, { accessStatus: 'approved' })
    built.memory.organization.push({ id: ORGANIZATION_A, name: 'Organization a', slug: 'a', createdAt: new Date() })
    built.memory.member.push({ id: crypto.randomUUID(), organizationId: ORGANIZATION_A, userId: signedIn.userId!, role: 'owner', createdAt: new Date() })
    member = signedIn.cookie
  })
  afterAll(() => built.app.close())

  it.each(dashboardPaths)('%s refuses the dashboard statement', async (path) => {
    expect((await call(path, { [ACCESS_HEADER]: DASHBOARD_ACCESS }, 'not-an-object')).statusCode).toBe(403)
  })

  it.each(dashboardPaths)('%s still lets an approved member in', async (path) => {
    expect(passed((await call(path, { cookie: member }, 'not-an-object')).statusCode)).toBe(true)
  })
})

describe('public and account procedures', () => {
  let built: Awaited<ReturnType<typeof buildTestApp>>
  beforeAll(async () => {
    built = await buildTestApp()
  })
  afterAll(() => built.app.close())

  it.each(paths.filter((path) => EXPECTED[path] === 'public'))('%s needs no session', async (path) => {
    const type = procedures[path]!._def.type
    const res =
      type === 'query'
        ? await built.app.inject({ method: 'GET', url: `/trpc/${path}`, headers: { authorization: `Bearer ${TOKEN}` } })
        : await built.app.inject({
            method: 'POST',
            url: `/trpc/${path}`,
            headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
            payload: '"not-an-object"',
          })
    expect([401, 403]).not.toContain(res.statusCode)
  })

  it.each(paths.filter((path) => EXPECTED[path] === 'account'))(
    '%s needs an account, and the dashboard statement is not one',
    async (path) => {
      const type = procedures[path]!._def.type
      const headers = { authorization: `Bearer ${TOKEN}`, [ACCESS_HEADER]: DASHBOARD_ACCESS }
      const res =
        type === 'query'
          ? await built.app.inject({ method: 'GET', url: `/trpc/${path}`, headers })
          : await built.app.inject({ method: 'POST', url: `/trpc/${path}`, headers: { ...headers, 'content-type': 'application/json' }, payload: 'null' })
      expect(res.statusCode).toBe(401)
    },
  )
})
