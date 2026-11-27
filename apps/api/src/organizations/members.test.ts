import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TOKEN, buildTestApp } from '../test/auth.js'
import { ACCESS_HEADER, DASHBOARD_ACCESS } from '../trpc/init.js'

/**
 * Members and invitations, through the API as the dashboard server calls it, on the in-memory
 * store. Names, addresses and ids are invented.
 */

const ORGANIZATION_A = '00000000-0000-4000-8000-0000000000a1'
const ORGANIZATION_B = '00000000-0000-4000-8000-0000000000b2'

type Built = Awaited<ReturnType<typeof buildTestApp>>

interface Listed {
  accounts: boolean
  mail: boolean
  via: 'password' | 'account'
  you: { memberId: string; role: string } | null
  canManage: boolean
  members: { id: string; userId: string; email: string; role: string }[]
  invitations: { id: string; email: string; role: string }[]
}

const QUERIES = new Set(['members.list', 'apps.list', 'account.get'])

function caller(built: () => Built) {
  return (path: string, headers: Record<string, string>, input?: unknown) => {
    const base = { authorization: `Bearer ${TOKEN}`, ...headers }
    return QUERIES.has(path)
      ? built().app.inject({ method: 'GET', url: `/trpc/${path}`, headers: base })
      : built().app.inject({
          method: 'POST',
          url: `/trpc/${path}`,
          headers: { ...base, 'content-type': 'application/json' },
          payload: JSON.stringify(input ?? null),
        })
  }
}

const data = <T>(res: { json(): unknown }) => (res.json() as { result: { data: T } }).result.data
const message = (res: { json(): unknown }) => (res.json() as { error: { message: string } }).error.message

describe('members of an organization', () => {
  let built: Built
  const call = caller(() => built)
  const people: Record<string, { cookie: string; userId: string }> = {}
  const as = (name: string) => ({ cookie: people[name]!.cookie })
  const list = async (name: string) => data<Listed>(await call('members.list', as(name)))
  const memberId = async (name: string) => (await list('owner-a')).members.find((row) => row.userId === people[name]!.userId)!.id

  beforeAll(async () => {
    built = await buildTestApp()
    const context = await built.auth.$context
    for (const [id, slug] of [[ORGANIZATION_A, 'a'], [ORGANIZATION_B, 'b']] as const) {
      built.memory.organization.push({ id, name: `Organization ${slug}`, slug, createdAt: new Date() })
    }
    const person = async (name: string, organizationId: string, role: string) => {
      const signedIn = await built.signIn({ email: `${name}@example.com`, emailVerified: true })
      await context.internalAdapter.updateUser(signedIn.userId!, { accessStatus: 'approved' })
      built.memory.member.push({ id: crypto.randomUUID(), organizationId, userId: signedIn.userId!, role, createdAt: new Date() })
      people[name] = { cookie: signedIn.cookie, userId: signedIn.userId! }
    }
    await person('owner-a', ORGANIZATION_A, 'owner')
    await person('admin-a', ORGANIZATION_A, 'admin')
    await person('member-a', ORGANIZATION_A, 'member')
    await person('owner-b', ORGANIZATION_B, 'owner')
  })
  afterAll(() => built.app.close())

  it('lists the members, with their roles, to anyone in the organization', async () => {
    const listed = await list('member-a')
    expect(listed.accounts).toBe(true)
    expect(listed.members.map((row) => [row.email, row.role])).toEqual([
      ['owner-a@example.com', 'owner'],
      ['admin-a@example.com', 'admin'],
      ['member-a@example.com', 'member'],
    ])
    expect(listed.you?.role).toBe('member')
    expect(listed.canManage).toBe(false)
    expect((await list('owner-a')).canManage).toBe(true)
  })

  it('never lists another organization', async () => {
    expect((await list('owner-b')).members.map((row) => row.email)).toEqual(['owner-b@example.com'])
  })

  it('lets an owner invite an address, and mails it a sign-in link', async () => {
    const res = await call('members.invite', as('owner-a'), { email: ' Invited-One@Example.com ', role: 'member' })
    expect(res.statusCode).toBe(200)
    expect(data<{ mailed: boolean }>(res).mailed).toBe(true)

    const listed = await list('owner-a')
    expect(listed.invitations.map((row) => [row.email, row.role])).toEqual([['invited-one@example.com', 'member']])
    const [mail] = built.mailTo('invited-one@example.com')
    expect(mail?.text).toContain('https://apphq.example.com/login')
    // Nothing anyone typed: not the organization's name, nor who sent it.
    expect(mail?.text).not.toContain('Organization a')
    expect(mail?.text).not.toContain('owner-a')
  })

  it('replaces an invitation when the address is invited again', async () => {
    expect((await call('members.invite', as('owner-a'), { email: 'invited-one@example.com', role: 'admin' })).statusCode).toBe(200)
    const listed = await list('owner-a')
    expect(listed.invitations.map((row) => [row.email, row.role])).toEqual([['invited-one@example.com', 'admin']])
  })

  it('refuses to invite a member, or something that is not an address', async () => {
    const res = await call('members.invite', as('owner-a'), { email: 'member-a@example.com', role: 'member' })
    expect(res.statusCode).toBe(400)
    expect(message(res)).toBe('That address already belongs to a member.')
    expect((await call('members.invite', as('owner-a'), { email: 'not an address', role: 'member' })).statusCode).toBe(400)
    expect((await call('members.invite', as('owner-a'), { email: 'x@example.com', role: 'superuser' })).statusCode).toBe(400)
  })

  describe('a member', () => {
    it('can neither invite, cancel, remove nor change roles', async () => {
      expect((await call('members.invite', as('member-a'), { email: 'someone@example.com', role: 'member' })).statusCode).toBe(403)
      const [invitation] = (await list('owner-a')).invitations
      expect((await call('members.cancelInvitation', as('member-a'), { invitationId: invitation!.id })).statusCode).toBe(403)
      expect((await call('members.remove', as('member-a'), { memberId: await memberId('admin-a') })).statusCode).toBe(403)
      expect((await call('members.setRole', as('member-a'), { memberId: await memberId('member-a'), role: 'owner' })).statusCode).toBe(403)
      expect((await list('owner-a')).members.map((row) => row.role)).toEqual(['owner', 'admin', 'member'])
    })

    it("doesn't see who has been invited", async () => {
      expect((await list('member-a')).invitations).toEqual([])
    })
  })

  describe('an admin', () => {
    it('can invite, but not an owner', async () => {
      expect((await call('members.invite', as('admin-a'), { email: 'by-admin@example.com', role: 'member' })).statusCode).toBe(200)
      const res = await call('members.invite', as('admin-a'), { email: 'would-own@example.com', role: 'owner' })
      expect(res.statusCode).toBe(403)
      expect(message(res)).toBe('Only an owner can invite an owner.')
    })

    it("can't remove an owner or change an owner's role", async () => {
      const owner = await memberId('owner-a')
      expect((await call('members.remove', as('admin-a'), { memberId: owner })).statusCode).toBe(400)
      expect((await call('members.setRole', as('admin-a'), { memberId: owner, role: 'member' })).statusCode).toBe(403)
      expect((await list('owner-a')).members[0]?.role).toBe('owner')
    })
  })

  describe('another organization', () => {
    it("can't cancel, remove or change anything in this one", async () => {
      const [invitation] = (await list('owner-a')).invitations
      const member = await memberId('member-a')
      expect((await call('members.cancelInvitation', as('owner-b'), { invitationId: invitation!.id })).statusCode).toBe(404)
      expect((await call('members.remove', as('owner-b'), { memberId: member })).statusCode).toBe(404)
      expect((await call('members.setRole', as('owner-b'), { memberId: member, role: 'admin' })).statusCode).toBe(404)

      const listed = await list('owner-a')
      expect(listed.invitations.map((row) => row.id)).toContain(invitation!.id)
      expect(listed.members.find((row) => row.id === member)?.role).toBe('member')
    })

    it("even with a session that says it works in this one", async () => {
      for (const row of built.memory.session.filter((found) => found.userId === people['owner-b']!.userId)) {
        row.activeOrganizationId = ORGANIZATION_A
      }
      expect((await list('owner-b')).members.map((row) => row.email)).toEqual(['owner-b@example.com'])
      expect((await call('members.remove', as('owner-b'), { memberId: await memberId('member-a') })).statusCode).toBe(404)
    })
  })

  describe('someone invited', () => {
    it('joins when they sign in with that address, without being approved', async () => {
      const signedIn = await built.signIn({ email: 'invited-one@example.com', emailVerified: true })
      people['invited-one'] = { cookie: signedIn.cookie, userId: signedIn.userId! }
      expect((await call('apps.list', as('invited-one'))).statusCode).toBe(403)

      const account = await call('account.get', as('invited-one'))
      expect(data<{ accessStatus: string | null }>(account).accessStatus).toBeNull()
      // In, and in A: the store has no apps, so the call fails past the guard, not at it.
      expect((await call('apps.list', as('invited-one'))).statusCode).not.toBe(403)
      expect(built.memory.session.filter((row) => row.userId === signedIn.userId).map((row) => row.activeOrganizationId)).toEqual([ORGANIZATION_A])

      const listed = await list('owner-a')
      expect(listed.members.find((row) => row.userId === signedIn.userId)?.role).toBe('admin')
      expect(listed.invitations.map((row) => row.email)).not.toContain('invited-one@example.com')
      // No organization of their own was made.
      expect(built.memory.member.filter((row) => row.userId === signedIn.userId)).toHaveLength(1)
    })

    it('joins when they sign up with that address and a password', async () => {
      expect((await call('members.invite', as('owner-a'), { email: 'signs-up@example.com', role: 'member' })).statusCode).toBe(200)
      const { res, cookie } = await built.signUp('signs-up@example.com', 'a-long-enough-test-password')
      expect(res.statusCode).toBe(200)
      await call('account.get', { cookie })
      expect((await call('apps.list', { cookie })).statusCode).not.toBe(403)
      expect((await list('owner-a')).members.map((row) => row.email)).toContain('signs-up@example.com')
    })

    it("doesn't join with another address", async () => {
      const signedIn = await built.signIn({ email: 'not-invited@example.com', emailVerified: true })
      await call('account.get', { cookie: signedIn.cookie })
      expect((await call('apps.list', { cookie: signedIn.cookie })).statusCode).toBe(403)
    })

    it("doesn't join once the invitation is cancelled", async () => {
      expect((await call('members.invite', as('owner-a'), { email: 'cancelled@example.com', role: 'member' })).statusCode).toBe(200)
      const invitation = (await list('owner-a')).invitations.find((row) => row.email === 'cancelled@example.com')!
      expect((await call('members.cancelInvitation', as('admin-a'), { invitationId: invitation.id })).statusCode).toBe(200)
      expect((await list('owner-a')).invitations.map((row) => row.email)).not.toContain('cancelled@example.com')

      const signedIn = await built.signIn({ email: 'cancelled@example.com', emailVerified: true })
      await call('account.get', { cookie: signedIn.cookie })
      expect((await call('apps.list', { cookie: signedIn.cookie })).statusCode).toBe(403)
    })

    it("doesn't join once the invitation has expired", async () => {
      expect((await call('members.invite', as('owner-a'), { email: 'late@example.com', role: 'member' })).statusCode).toBe(200)
      const row = built.memory.invitation.find((found) => found.email === 'late@example.com')!
      row.expiresAt = new Date(Date.now() - 1000)
      expect((await list('owner-a')).invitations.map((found) => found.email)).not.toContain('late@example.com')

      const signedIn = await built.signIn({ email: 'late@example.com', emailVerified: true })
      await call('account.get', { cookie: signedIn.cookie })
      expect((await call('apps.list', { cookie: signedIn.cookie })).statusCode).toBe(403)
    })
  })

  describe('roles and removal', () => {
    it('an owner changes a role, and it takes effect', async () => {
      const member = await memberId('member-a')
      expect((await call('members.setRole', as('owner-a'), { memberId: member, role: 'admin' })).statusCode).toBe(200)
      expect((await list('member-a')).canManage).toBe(true)
      expect((await call('members.setRole', as('owner-a'), { memberId: member, role: 'member' })).statusCode).toBe(200)
      expect((await list('member-a')).canManage).toBe(false)
    })

    it("keeps the last owner, and nobody removes themselves", async () => {
      const owner = await memberId('owner-a')
      expect((await call('members.setRole', as('owner-a'), { memberId: owner, role: 'member' })).statusCode).toBe(400)
      const res = await call('members.remove', as('owner-a'), { memberId: owner })
      expect(res.statusCode).toBe(400)
      expect(message(res)).toBe('You can’t remove yourself.')
    })

    it('an admin removes a member, who is then out of the dashboard', async () => {
      expect((await call('apps.list', as('member-a'))).statusCode).not.toBe(403)
      expect((await call('members.remove', as('admin-a'), { memberId: await memberId('member-a') })).statusCode).toBe(200)
      expect((await list('owner-a')).members.map((row) => row.email)).not.toContain('member-a@example.com')
      expect((await call('apps.list', as('member-a'))).statusCode).toBe(403)
      expect((await call('members.list', as('member-a'))).statusCode).toBe(403)
    })
  })

  describe('the dashboard password', () => {
    const password = { [ACCESS_HEADER]: DASHBOARD_ACCESS }

    it('sees the members of its organization, but changes nothing', async () => {
      const listed = data<Listed>(await call('members.list', password))
      expect(listed.via).toBe('password')
      expect(listed.you).toBeNull()
      expect(listed.canManage).toBe(false)
      const res = await call('members.invite', password, { email: 'by-password@example.com', role: 'member' })
      expect(res.statusCode).toBe(412)
      expect(message(res)).toBe('Sign in with your account to change the members.')
    })
  })
})

describe('members with accounts off', () => {
  let built: Built
  const call = caller(() => built)
  beforeAll(async () => {
    built = await buildTestApp({ accounts: false })
  })
  afterAll(() => built.app.close())

  it('says so instead of failing', async () => {
    const res = await call('members.list', { [ACCESS_HEADER]: DASHBOARD_ACCESS })
    expect(res.statusCode).toBe(200)
    expect(data(res)).toEqual({ accounts: false })
    expect((await call('members.invite', { [ACCESS_HEADER]: DASHBOARD_ACCESS }, { email: 'x@example.com', role: 'member' })).statusCode).toBe(412)
  })
})

describe('members without a mail server', () => {
  let built: Built
  const call = caller(() => built)
  let cookie: string
  beforeAll(async () => {
    built = await buildTestApp({ email: false })
    built.memory.organization.push({ id: ORGANIZATION_A, name: 'Organization a', slug: 'a', createdAt: new Date() })
    const signedIn = await built.signIn({ email: 'owner@example.com', emailVerified: true })
    built.memory.member.push({ id: crypto.randomUUID(), organizationId: ORGANIZATION_A, userId: signedIn.userId!, role: 'owner', createdAt: new Date() })
    cookie = signedIn.cookie
  })
  afterAll(() => built.app.close())

  it('still invites, and says nothing was mailed', async () => {
    const res = await call('members.invite', { cookie }, { email: 'no-mail@example.com', role: 'member' })
    expect(res.statusCode).toBe(200)
    expect(data<{ mailed: boolean }>(res).mailed).toBe(false)
    expect(built.mail).toEqual([])
    expect(data<Listed>(await call('members.list', { cookie })).mail).toBe(false)
  })
})
