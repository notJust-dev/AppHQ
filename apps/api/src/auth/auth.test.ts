import { memoryAdapter } from 'better-auth/adapters/memory'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadEnv } from '../env.js'
import { ORIGIN, TOKEN, buildTestApp, cookieFrom, nextAddress } from '../test/auth.js'
import { authConfigFromEnv, authOptions, CLIENT_ADDRESS_HEADER, createAuth } from './auth.js'

const bearer = { authorization: `Bearer ${TOKEN}` }
const json = { 'content-type': 'application/json' }

describe('/api/auth', () => {
  let built: Awaited<ReturnType<typeof buildTestApp>>
  beforeAll(async () => {
    built = await buildTestApp()
  })
  afterAll(() => built.app.close())

  const post = (path: string, headers: Record<string, string> = {}, body: unknown = {}) =>
    built.app.inject({
      method: 'POST',
      url: `/api/auth${path}`,
      headers: { ...bearer, ...json, origin: ORIGIN, [CLIENT_ADDRESS_HEADER]: nextAddress(), ...headers },
      payload: JSON.stringify(body),
    })

  it('needs the internal token', async () => {
    const res = await built.app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/social',
      headers: { ...json, origin: ORIGIN },
      payload: JSON.stringify({ provider: 'github' }),
    })
    expect(res.statusCode).toBe(401)
  })

  it.each([
    '/sign-up/email',
    '/sign-in/email',
    '/update-user',
    '/change-email',
    '/link-social',
    '/list-sessions',
    '/get-session',
    '/ok',
    '/error',
    '/admin/set-role',
    '/sign-in/social/',
    '/SIGN-IN/SOCIAL',
    '/%2e%2e/trpc/apps.list',
    '/sign-in%2Fsocial',
  ])('does not serve %s', async (path) => {
    const res = await built.app.inject({ method: 'POST', url: `/api/auth${path}`, headers: { ...bearer, ...json, origin: ORIGIN }, payload: '{}' })
    expect(res.statusCode).toBe(404)
    const get = await built.app.inject({ method: 'GET', url: `/api/auth${path}`, headers: bearer })
    expect(get.statusCode).toBe(404)
  })

  it('starts a GitHub sign-in that comes back to the dashboard', async () => {
    const res = await post('/sign-in/social', {}, { provider: 'github', callbackURL: '/request-access' })
    expect(res.statusCode).toBe(200)
    const { url } = res.json() as { url: string }
    const authorize = new URL(url)
    expect(authorize.origin).toBe('https://github.com')
    expect(authorize.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/api/auth/callback/github`)
    expect(res.headers['cache-control']).toBe('no-store')
    // The state travels in a cookie, so nothing was written for this anonymous visitor.
    expect(cookieFrom(res.headers['set-cookie'])).toMatch(/^__Secure-better-auth\.oauth_state=/)
    expect(built.memory.verification).toHaveLength(0)
  })

  it('ignores the Host header when it writes addresses', async () => {
    const res = await post('/sign-in/social', { host: 'evil.example', 'x-forwarded-host': 'evil.example' }, { provider: 'github' })
    expect(new URL((res.json() as { url: string }).url).searchParams.get('redirect_uri')).toBe(`${ORIGIN}/api/auth/callback/github`)
  })

  it('refuses a callback address on another site', async () => {
    const res = await post('/sign-in/social', {}, { provider: 'github', callbackURL: 'https://evil.example/' })
    expect(res.statusCode).toBe(403)
  })

  it('refuses the ID token sign-in in the production configuration', async () => {
    const auth = createAuth(authOptions({ secret: 'x'.repeat(32), url: ORIGIN, google: { clientId: 'id', clientSecret: 'secret' } }, memoryAdapter({ user: [], session: [], account: [], verification: [] })))
    const res = await auth.handler(
      new Request(`${ORIGIN}/api/auth/sign-in/social`, {
        method: 'POST',
        headers: { ...json, origin: ORIGIN },
        body: JSON.stringify({ provider: 'google', idToken: { token: 'a.b.c' } }),
      }),
    )
    expect(res.status).toBe(404)
  })

  it('limits how often one address can start a sign-in', async () => {
    const address = '203.0.113.7'
    const statuses: number[] = []
    for (let i = 0; i < 11; i++) {
      statuses.push((await post('/sign-in/social', { [CLIENT_ADDRESS_HEADER]: address }, { provider: 'github' })).statusCode)
    }
    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(200))
    expect(statuses[10]).toBe(429)
    // Another address is not affected.
    expect((await post('/sign-in/social', { [CLIENT_ADDRESS_HEADER]: '203.0.113.8' }, { provider: 'github' })).statusCode).toBe(200)
  })

  it('stores neither the address nor the browser on the session', async () => {
    const { cookie } = await built.signIn({ email: 'quiet@example.com', emailVerified: true })
    expect(cookie).toMatch(/session_token=/)
    const userId = built.memory.user.find((row) => row.email === 'quiet@example.com')?.id
    const sessions = built.memory.session.filter((row) => row.userId === userId)
    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.ipAddress ?? null).toBeNull()
    expect(sessions[0]?.userAgent ?? null).toBeNull()
  })

  it('gives no session to an address the provider has not verified', async () => {
    const { res, cookie } = await built.signIn({ email: 'unverified@example.com', emailVerified: false })
    expect(res.statusCode).toBe(403)
    expect(cookie).not.toMatch(/session_token/)
  })

  it('signs out, clearing every cookie it set', async () => {
    const { cookie } = await built.signIn({ email: 'leaving@example.com', emailVerified: true })
    const res = await post('/sign-out', { cookie })
    expect(res.statusCode).toBe(200)
    const cleared = [res.headers['set-cookie'] ?? []].flat()
    expect(cleared.length).toBeGreaterThanOrEqual(2)
    expect(cleared.some((line) => /session_token=;/.test(line) || /session_token=.*Max-Age=0/i.test(line))).toBe(true)
    // The session is gone on the server, not only from the browser.
    const after = await built.app.inject({ method: 'GET', url: '/trpc/account.get', headers: { ...bearer, cookie } })
    expect(after.statusCode).toBe(401)
  })

  it('refuses a sign-out sent from another site', async () => {
    const { cookie } = await built.signIn({ email: 'staying@example.com', emailVerified: true })
    const res = await post('/sign-out', { cookie, origin: 'https://evil.example' })
    expect(res.statusCode).toBe(403)
  })
})

describe('server-only fields', () => {
  let built: Awaited<ReturnType<typeof buildTestApp>>
  beforeAll(async () => {
    built = await buildTestApp()
  })
  afterAll(() => built.app.close())

  const stored = (email: string) => built.memory.user.find((row) => row.email === email)

  it('a provider profile cannot set the access status or a role', async () => {
    const { userId } = await built.signIn({
      email: 'sneaky@example.com',
      emailVerified: true,
      extra: { accessStatus: 'approved', accessRequestedAt: new Date(0).toISOString(), role: 'admin' },
    })
    expect(userId).toBeDefined()
    const row = stored('sneaky@example.com')
    expect(row?.accessStatus ?? null).toBeNull()
    expect(row?.accessRequestedAt ?? null).toBeNull()
    expect(row).not.toHaveProperty('role')
  })

  it('a profile update cannot set them either, over HTTP or by calling Better Auth directly', async () => {
    const { cookie } = await built.signIn({ email: 'updater@example.com', emailVerified: true })
    const http = await built.app.inject({
      method: 'POST',
      url: '/api/auth/update-user',
      headers: { ...bearer, ...json, origin: ORIGIN, cookie },
      payload: JSON.stringify({ accessStatus: 'approved', role: 'admin' }),
    })
    expect(http.statusCode).toBe(404)

    await expect(
      built.auth.api.updateUser({ headers: new Headers({ cookie }), body: { accessStatus: 'approved' } as never }),
    ).rejects.toThrow()
    expect(stored('updater@example.com')?.accessStatus ?? null).toBeNull()
  })

  it('a sign-up body cannot set them, because there is no sign-up by email', async () => {
    const res = await built.app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { ...bearer, ...json, origin: ORIGIN },
      payload: JSON.stringify({ email: 'new@example.com', password: 'a-long-password', name: 'x', accessStatus: 'approved' }),
    })
    expect(res.statusCode).toBe(404)
    await expect(
      built.auth.api.signUpEmail({ body: { email: 'new@example.com', password: 'a-long-password', name: 'x', accessStatus: 'approved' } as never }),
    ).rejects.toThrow()
    expect(stored('new@example.com')).toBeUndefined()
  })
})

describe('requesting access', () => {
  let built: Awaited<ReturnType<typeof buildTestApp>>
  beforeAll(async () => {
    built = await buildTestApp()
  })
  afterAll(() => built.app.close())

  const call = (path: 'account.get' | 'account.requestAccess', cookie?: string) =>
    path === 'account.get'
      ? built.app.inject({ method: 'GET', url: `/trpc/${path}`, headers: { ...bearer, ...(cookie ? { cookie } : {}) } })
      : built.app.inject({ method: 'POST', url: `/trpc/${path}`, headers: { ...bearer, ...json, ...(cookie ? { cookie } : {}) }, payload: 'null' })
  const data = (res: { json(): unknown }) => (res.json() as { result: { data: Record<string, unknown> } }).result.data

  it('needs a signed-in account', async () => {
    expect((await call('account.get')).statusCode).toBe(401)
    expect((await call('account.requestAccess')).statusCode).toBe(401)
    expect((await call('account.get', 'better-auth.session_token=made-up.value')).statusCode).toBe(401)
  })

  it('records the request once and keeps the first date', async () => {
    const { cookie } = await built.signIn({ email: 'asker@example.com', emailVerified: true })
    expect(data(await call('account.get', cookie))).toMatchObject({ email: 'asker@example.com', accessStatus: null, accessRequestedAt: null })

    const first = data(await call('account.requestAccess', cookie))
    expect(first.accessStatus).toBe('requested')
    expect(typeof first.accessRequestedAt).toBe('string')

    const second = data(await call('account.requestAccess', cookie))
    expect(second).toEqual(first)
  })

  it('never undoes an approval', async () => {
    const { cookie, userId } = await built.signIn({ email: 'approved-asker@example.com', emailVerified: true })
    const context = await built.auth.$context
    await context.internalAdapter.updateUser(userId!, { accessStatus: 'approved' })
    expect(data(await call('account.requestAccess', cookie)).accessStatus).toBe('approved')
  })

  it('shows only the account itself', async () => {
    const { cookie } = await built.signIn({ email: 'private@example.com', emailVerified: true })
    expect(Object.keys(data(await call('account.get', cookie))).sort()).toEqual(['accessRequestedAt', 'accessStatus', 'email', 'name'])
  })
})

describe('with accounts off', () => {
  let built: Awaited<ReturnType<typeof buildTestApp>>
  beforeAll(async () => {
    built = await buildTestApp({ accounts: false })
  })
  afterAll(() => built.app.close())

  it('has no /api/auth', async () => {
    const res = await built.app.inject({ method: 'POST', url: '/api/auth/sign-in/social', headers: { ...bearer, ...json }, payload: '{}' })
    expect(res.statusCode).toBe(404)
  })

  it('offers no sign-in and has no accounts', async () => {
    const config = await built.app.inject({ method: 'GET', url: '/trpc/account.config', headers: bearer })
    expect(config.json()).toEqual({ result: { data: { providers: [] } } })
    const get = await built.app.inject({ method: 'GET', url: '/trpc/account.get', headers: { ...bearer, cookie: 'better-auth.session_token=x.y' } })
    expect(get.statusCode).toBe(401)
  })
})

describe('the accounts configuration', () => {
  const base = { INTERNAL_API_TOKEN: 'x'.repeat(32), DATABASE_URL: 'postgres://u:p@127.0.0.1/db' }
  const secret = 'test-secret-that-is-at-least-32-characters'

  it('is off unless it is set, as for every existing install', () => {
    expect(authConfigFromEnv(loadEnv(base))).toBeNull()
    expect(authConfigFromEnv(loadEnv({ ...base, BETTER_AUTH_SECRET: '', BETTER_AUTH_URL: '' }))).toBeNull()
  })

  it('is off without a sign-in provider', () => {
    expect(authConfigFromEnv(loadEnv({ ...base, BETTER_AUTH_SECRET: secret, BETTER_AUTH_URL: ORIGIN }))).toBeNull()
  })

  it('is on with a provider', () => {
    const config = authConfigFromEnv(
      loadEnv({ ...base, BETTER_AUTH_SECRET: secret, BETTER_AUTH_URL: ORIGIN, AUTH_GITHUB_CLIENT_ID: 'id', AUTH_GITHUB_CLIENT_SECRET: 'secret' }),
    )
    expect(config).toMatchObject({ url: ORIGIN, github: { clientId: 'id' } })
    expect(config?.google).toBeUndefined()
  })

  it.each([
    [{ BETTER_AUTH_SECRET: secret }, /BETTER_AUTH_URL/],
    [{ BETTER_AUTH_SECRET: 'short', BETTER_AUTH_URL: ORIGIN }, /BETTER_AUTH_SECRET/],
    [{ BETTER_AUTH_SECRET: secret, BETTER_AUTH_URL: `${ORIGIN}/dashboard` }, /BETTER_AUTH_URL/],
    [{ BETTER_AUTH_SECRET: secret, BETTER_AUTH_URL: 'ftp://apphq.example.com' }, /BETTER_AUTH_URL/],
    [{ BETTER_AUTH_SECRET: secret, BETTER_AUTH_URL: ORIGIN, AUTH_GOOGLE_CLIENT_ID: 'id' }, /AUTH_GOOGLE_CLIENT_SECRET/],
    [{ AUTH_GITHUB_CLIENT_ID: 'id', AUTH_GITHUB_CLIENT_SECRET: 'secret' }, /BETTER_AUTH_SECRET/],
  ])('rejects a half-set configuration: %j', (vars, message) => {
    expect(() => loadEnv({ ...base, ...vars })).toThrow(message)
  })
})
