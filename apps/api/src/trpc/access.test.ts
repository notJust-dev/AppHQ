import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TOKEN, buildTestApp } from '../test/auth.js'
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

describe('dashboard procedures', () => {
  let built: Awaited<ReturnType<typeof buildTestApp>>
  let verified: string
  let approved: string

  beforeAll(async () => {
    built = await buildTestApp()
    verified = (await built.signIn({ email: 'verified@example.com', emailVerified: true })).cookie

    const signedIn = await built.signIn({ email: 'approved@example.com', emailVerified: true })
    approved = signedIn.cookie
    const context = await built.auth.$context
    await context.internalAdapter.updateUser(signedIn.userId!, { accessStatus: 'approved' })
  })
  afterAll(() => built.app.close())

  /** Calls a procedure the way the dashboard server does, with the given extra headers. */
  const call = (path: string, headers: Record<string, string>, input?: unknown) => {
    const type = procedures[path]!._def.type
    const base = { authorization: `Bearer ${TOKEN}`, ...headers }
    return type === 'query'
      ? built.app.inject({
          method: 'GET',
          url: `/trpc/${path}${input === undefined ? '' : `?input=${encodeURIComponent(JSON.stringify(input))}`}`,
          headers: base,
        })
      : built.app.inject({
          method: 'POST',
          url: `/trpc/${path}`,
          headers: { ...base, 'content-type': 'application/json' },
          payload: JSON.stringify(input ?? null),
        })
  }

  it('the sessions used below are real', async () => {
    expect(verified).toMatch(/better-auth\.session_token=/)
    expect(approved).toMatch(/better-auth\.session_token=/)
    const res = await call('account.get', { cookie: approved })
    expect(res.statusCode).toBe(200)
    expect(res.json().result.data.accessStatus).toBe('approved')
  })

  it.each(dashboardPaths)('%s refuses the internal token alone', async (path) => {
    expect((await call(path, {})).statusCode).toBe(403)
  })

  it.each(dashboardPaths)('%s refuses a signed-in account', async (path) => {
    expect((await call(path, { cookie: verified })).statusCode).toBe(403)
  })

  it.each(dashboardPaths)('%s refuses an account whose access was approved', async (path) => {
    expect((await call(path, { cookie: approved })).statusCode).toBe(403)
  })

  it.each(['1', 'true', 'DASHBOARD', ' dashboard', 'dashboard, dashboard'])(
    'refuses an access header of %j',
    async (value) => {
      expect((await call('apps.list', { [ACCESS_HEADER]: value, cookie: approved })).statusCode).toBe(403)
    },
  )

  // With the statement the guard lets the call through: the input is wrong or the (absent)
  // database fails, but nothing says "forbidden".
  it.each(dashboardPaths)('%s passes the guard with the dashboard statement', async (path) => {
    const res = await call(path, { [ACCESS_HEADER]: DASHBOARD_ACCESS }, 'not-an-object')
    expect([401, 403]).not.toContain(res.statusCode)
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
