import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ORIGIN, TOKEN, buildTestApp } from '../test/auth.js'
import { CLIENT_ADDRESS_HEADER } from './auth.js'
import { CODE_ATTEMPTS, EMAIL_PATHS, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from './email.js'

const bearer = { authorization: `Bearer ${TOKEN}` }
const PASSWORD = 'a-test-password-of-enough-length'
const OTHER_PASSWORD = 'another-test-password-long-enough'
/** One character short of the shortest password allowed, and one over the longest. */
const TOO_SHORT = 'x'.repeat(MIN_PASSWORD_LENGTH - 1)
const TOO_LONG = 'x'.repeat(MAX_PASSWORD_LENGTH + 1)

type Built = Awaited<ReturnType<typeof buildTestApp>>
const errorCode = (res: { json(): unknown }) => (res.json() as { code?: string }).code
/** A six-digit code that is not the one given. */
const wrongCode = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, '0')

describe('signing up with an email address', () => {
  let built: Built
  beforeAll(async () => {
    built = await buildTestApp()
  })
  afterAll(() => built.app.close())

  const user = (email: string) => built.memory.user.find((row) => row.email === email)
  const methods = (email: string) => built.memory.account.filter((row) => row.userId === user(email)?.id)

  it('mails a code and makes no account until it is confirmed', async () => {
    const email = 'new-person@example.com'
    const res = await built.post('/email-sign-up/send-code', { email })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: true })
    expect(res.headers['set-cookie']).toBeUndefined()

    expect(built.mailTo(email)).toHaveLength(1)
    const [message] = built.mailTo(email)
    const code = built.lastCode(email)
    expect(message!.subject).toContain(code)
    expect(message!.html).toContain(code)
    // No account, and neither the code nor the address is anywhere in the store.
    expect(user(email)).toBeUndefined()
    expect(JSON.stringify(built.memory.verification)).not.toContain(code)
    expect(JSON.stringify(built.memory)).not.toContain(email)
  })

  it('makes the account, already confirmed, and signs it in when the code is right', async () => {
    const email = 'confirmed@example.com'
    const { res, cookie } = await built.signUp(email, PASSWORD)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: true })
    expect(cookie).toMatch(/session_token=/)

    expect(user(email)).toMatchObject({ emailVerified: true, name: '' })
    expect(user(email)?.accessStatus ?? null).toBeNull()
    expect(methods(email)).toHaveLength(1)
    expect(methods(email)[0]).toMatchObject({ providerId: 'credential' })
    // Stored scrambled, never as typed.
    expect(methods(email)[0]?.password).toBeTruthy()
    expect(JSON.stringify(built.memory.account)).not.toContain(PASSWORD)
    // Like every session, it keeps neither the address nor the browser.
    const [session] = built.memory.session.filter((row) => row.userId === user(email)?.id)
    expect(session?.ipAddress ?? null).toBeNull()
    expect(session?.userAgent ?? null).toBeNull()

    const account = await built.app.inject({ method: 'GET', url: '/trpc/account.get', headers: { ...bearer, cookie } })
    expect(account.statusCode).toBe(200)
    expect((account.json() as { result: { data: unknown } }).result.data).toMatchObject({ email, accessStatus: null })
    // Signed up is not let in: the dashboard still needs approved access.
    expect((await built.app.inject({ method: 'GET', url: '/trpc/apps.list', headers: { ...bearer, cookie } })).statusCode).toBe(403)
  })

  it('takes the address in any case and stores it in lower case', async () => {
    const { res } = await built.signUp('Mixed.Case@Example.com', PASSWORD)
    expect(res.statusCode).toBe(200)
    expect(user('mixed.case@example.com')).toBeDefined()
    expect((await built.post('/sign-in/email', { email: 'MIXED.CASE@example.com', password: PASSWORD })).statusCode).toBe(200)
  })

  it('refuses a wrong code and makes nothing', async () => {
    const email = 'guessed@example.com'
    await built.post('/email-sign-up/send-code', { email })
    const res = await built.post('/email-sign-up/confirm', { email, code: wrongCode(built.lastCode(email)), password: PASSWORD })
    expect(res.statusCode).toBe(400)
    expect(errorCode(res)).toBe('INVALID_CODE')
    expect(res.headers['set-cookie']).toBeUndefined()
    expect(user(email)).toBeUndefined()
    // The right code still works after one wrong guess.
    expect((await built.post('/email-sign-up/confirm', { email, code: built.lastCode(email), password: PASSWORD })).statusCode).toBe(200)
  })

  it('spends the code after a few wrong guesses, so the right one no longer works', async () => {
    const email = 'many-guesses@example.com'
    await built.post('/email-sign-up/send-code', { email })
    const code = built.lastCode(email)
    const codes: (string | undefined)[] = []
    for (let i = 0; i < CODE_ATTEMPTS; i++) {
      codes.push(errorCode(await built.post('/email-sign-up/confirm', { email, code: wrongCode(code), password: PASSWORD })))
    }
    expect(codes.slice(0, -1)).toEqual(Array(CODE_ATTEMPTS - 1).fill('INVALID_CODE'))
    expect(codes.at(-1)).toBe('TOO_MANY_ATTEMPTS')

    const late = await built.post('/email-sign-up/confirm', { email, code, password: PASSWORD })
    expect(late.statusCode).toBe(400)
    expect(user(email)).toBeUndefined()
  })

  it('counts every guess when several arrive at once', async () => {
    const email = 'burst@example.com'
    await built.post('/email-sign-up/send-code', { email })
    const code = built.lastCode(email)
    const guesses = Array.from({ length: 30 }, (_, i) => String((Number(code) + 1 + i) % 1_000_000).padStart(6, '0'))
    await Promise.all(guesses.map((guess) => built.post('/email-sign-up/confirm', { email, code: guess, password: PASSWORD })))
    // Thirty guesses are far more than a code survives, however they were interleaved.
    expect((await built.post('/email-sign-up/confirm', { email, code, password: PASSWORD })).statusCode).toBe(400)
    expect(user(email)).toBeUndefined()
  })

  it('works once: the same code makes no second account and signs nobody in', async () => {
    const email = 'once@example.com'
    await built.signUp(email, PASSWORD)
    const again = await built.post('/email-sign-up/confirm', { email, code: built.lastCode(email), password: OTHER_PASSWORD })
    expect(again.statusCode).toBe(400)
    expect(again.headers['set-cookie']).toBeUndefined()
    expect(built.memory.user.filter((row) => row.email === email)).toHaveLength(1)
    // The password is still the first one.
    expect((await built.post('/sign-in/email', { email, password: OTHER_PASSWORD })).statusCode).toBe(401)
  })

  it('a code for one address confirms no other', async () => {
    await built.post('/email-sign-up/send-code', { email: 'mine@example.com' })
    await built.post('/email-sign-up/send-code', { email: 'theirs@example.com' })
    const res = await built.post('/email-sign-up/confirm', { email: 'theirs@example.com', code: built.lastCode('mine@example.com'), password: PASSWORD })
    // The two codes could be equal by chance once in a million runs; then this is a sign-up.
    if (built.lastCode('mine@example.com') !== built.lastCode('theirs@example.com')) {
      expect(res.statusCode).toBe(400)
      expect(user('theirs@example.com')).toBeUndefined()
    }
  })

  it('turns down a password that is too short or too long without spending a guess', async () => {
    const email = 'short-password@example.com'
    await built.post('/email-sign-up/send-code', { email })
    const code = built.lastCode(email)
    for (let i = 0; i < CODE_ATTEMPTS + 2; i++) {
      const short = await built.post('/email-sign-up/confirm', { email, code, password: TOO_SHORT })
      expect(short.statusCode).toBe(400)
      expect(errorCode(short)).toBe('PASSWORD_TOO_SHORT')
    }
    expect(errorCode(await built.post('/email-sign-up/confirm', { email, code, password: TOO_LONG }))).toBe('PASSWORD_TOO_LONG')
    expect(user(email)).toBeUndefined()
    // The shortest password allowed is taken, and signs in afterwards.
    const shortest = 'x'.repeat(MIN_PASSWORD_LENGTH)
    expect((await built.post('/email-sign-up/confirm', { email, code, password: shortest })).statusCode).toBe(200)
    expect((await built.post('/sign-in/email', { email, password: shortest })).statusCode).toBe(200)
  })

  it('a sign-up body cannot set the access status or a role', async () => {
    const email = 'sneaky-sign-up@example.com'
    await built.post('/email-sign-up/send-code', { email, accessStatus: 'approved', role: 'admin' })
    const res = await built.post('/email-sign-up/confirm', {
      email,
      code: built.lastCode(email),
      password: PASSWORD,
      name: 'Made up',
      accessStatus: 'approved',
      accessRequestedAt: new Date(0).toISOString(),
      emailVerified: true,
      role: 'admin',
    })
    expect(res.statusCode).toBe(200)
    expect(user(email)?.accessStatus ?? null).toBeNull()
    expect(user(email)?.accessRequestedAt ?? null).toBeNull()
    expect(user(email)).toMatchObject({ name: '' })
    expect(user(email)).not.toHaveProperty('role')
  })

  it('keeps a fresh code when another is asked for straight away', async () => {
    const email = 'impatient@example.com'
    await built.post('/email-sign-up/send-code', { email })
    const first = built.lastCode(email)
    expect((await built.post('/email-sign-up/send-code', { email })).json()).toEqual({ status: true })
    expect(built.mailTo(email)).toHaveLength(1)
    expect((await built.post('/email-sign-up/confirm', { email, code: first, password: PASSWORD })).statusCode).toBe(200)
  })

  it('tells an address that already has a password account so, with the same answer and no code', async () => {
    const email = 'already-here@example.com'
    await built.signUp(email, PASSWORD)
    const before = built.mailTo(email).length

    const res = await built.post('/email-sign-up/send-code', { email })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: true })
    const notice = built.mailTo(email).at(-1)!
    expect(built.mailTo(email)).toHaveLength(before + 1)
    expect(notice.subject).toMatch(/already have/)
    expect(notice.text).not.toMatch(/^\d{6}$/m)
    expect(notice.text).toContain(`${ORIGIN}/login`)
    expect(notice.text).toContain(`${ORIGIN}/forgot-password`)

    // No code exists, so nothing confirms, and the password stays the owner's.
    for (const code of ['000000', '123456']) {
      expect((await built.post('/email-sign-up/confirm', { email, code, password: OTHER_PASSWORD })).statusCode).toBe(400)
    }
    expect((await built.post('/sign-in/email', { email, password: PASSWORD })).statusCode).toBe(200)
    expect((await built.post('/sign-in/email', { email, password: OTHER_PASSWORD })).statusCode).toBe(401)
  })

  it('gives an address that signed in with Google no password, and says how it signs in', async () => {
    const email = 'google-person@example.com'
    await built.signIn({ email, emailVerified: true })

    expect((await built.post('/email-sign-up/send-code', { email })).json()).toEqual({ status: true })
    const notice = built.mailTo(email).at(-1)!
    expect(notice.subject).toMatch(/already have/)
    expect(notice.text).toMatch(/signs in with Google/)
    expect(notice.text).not.toContain('forgot-password')

    expect((await built.post('/email-sign-up/confirm', { email, code: '123456', password: PASSWORD })).statusCode).toBe(400)
    expect(methods(email).map((row) => row.providerId)).toEqual(['google'])
    expect((await built.post('/sign-in/email', { email, password: PASSWORD })).statusCode).toBe(401)
  })

  it('refuses the code when the address got an account in the meantime', async () => {
    const email = 'raced@example.com'
    await built.post('/email-sign-up/send-code', { email })
    const code = built.lastCode(email)
    await built.signIn({ email, emailVerified: true })

    expect((await built.post('/email-sign-up/confirm', { email, code, password: PASSWORD })).statusCode).toBe(400)
    expect(methods(email).map((row) => row.providerId)).toEqual(['google'])
  })

  it('an address with a password account cannot then sign in with Google', async () => {
    const email = 'password-first@example.com'
    await built.signUp(email, PASSWORD)
    const { cookie } = await built.signIn({ email, emailVerified: true })
    expect(cookie).not.toMatch(/session_token/)
    expect(methods(email).map((row) => row.providerId)).toEqual(['credential'])
  })

  it('mails one address once however many visitors ask in the same minute', async () => {
    const fresh = 'flooded@example.com'
    const taken = 'flooded-owner@example.com'
    await built.signUp(taken, PASSWORD)
    // Each request comes from a different visitor address, so no per-visitor limit applies.
    for (const email of [fresh, taken]) {
      const before = built.mailTo(email).length
      for (let i = 0; i < 12; i++) expect((await built.post('/email-sign-up/send-code', { email })).statusCode).toBe(200)
      expect(built.mailTo(email)).toHaveLength(before + 1)
    }
  })

  it('answers an address with an account with the same work as one without', async () => {
    const taken = 'same-work@example.com'
    await built.signUp(taken, PASSWORD)
    const rows = () => built.memory.verification.length
    const before = rows()
    await built.post('/email-sign-up/send-code', { email: taken })
    await built.post('/email-sign-up/send-code', { email: 'same-work-new@example.com' })
    // One stored code each, though only the new address was sent one.
    expect(rows()).toBe(before + 2)
    expect(built.mailTo(taken).at(-1)?.subject).toMatch(/already have/)
  })

  it('limits how many codes one visitor can ask for', async () => {
    const visitor = { [CLIENT_ADDRESS_HEADER]: '203.0.113.40' }
    const statuses: number[] = []
    for (let i = 0; i < 6; i++) {
      statuses.push((await built.post('/email-sign-up/send-code', { email: `many-${i}@example.com` }, visitor)).statusCode)
    }
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429])
  })

  it('refuses an address that is not one', async () => {
    for (const email of ['not-an-address', 'a@b', '', 'two@example.com, three@example.com']) {
      expect((await built.post('/email-sign-up/send-code', { email })).statusCode).toBe(400)
    }
    expect(built.mail.some((message) => message.to.includes('two@'))).toBe(false)
  })

  it('refuses a sign-up sent from another site', async () => {
    const elsewhere = { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty' }
    const email = 'cross-site@example.com'
    expect((await built.post('/email-sign-up/send-code', { email }, elsewhere)).statusCode).toBe(403)
    expect(built.mailTo(email)).toHaveLength(0)

    await built.post('/email-sign-up/send-code', { email })
    const res = await built.post('/email-sign-up/confirm', { email, code: built.lastCode(email), password: PASSWORD }, elsewhere)
    expect(res.statusCode).toBe(403)
    expect(user(email)).toBeUndefined()
  })

  it('never puts what a visitor typed, other than the code they were sent, into a message', async () => {
    await built.post('/email-sign-up/send-code', { email: 'quiet-mail@example.com', name: 'Click https://evil.example now' })
    expect(JSON.stringify(built.mailTo('quiet-mail@example.com'))).not.toContain('evil.example')
  })

  it('has no other way to make an account with a password', async () => {
    const body = { email: 'side-door@example.com', password: PASSWORD, name: 'x' }
    expect((await built.post('/sign-up/email', body)).statusCode).toBe(404)
    await expect(built.auth.api.signUpEmail({ body })).rejects.toThrow()
    expect(user('side-door@example.com')).toBeUndefined()
  })
})

describe('signing in with an email address', () => {
  let built: Built
  const email = 'regular@example.com'
  beforeAll(async () => {
    built = await buildTestApp()
    await built.signUp(email, PASSWORD)
  })
  afterAll(() => built.app.close())

  it('signs in with the right password', async () => {
    const res = await built.post('/sign-in/email', { email, password: PASSWORD })
    expect(res.statusCode).toBe(200)
    expect(res.headers['cache-control']).toBe('no-store')
    const cookie = [res.headers['set-cookie'] ?? []].flat().join('; ')
    expect(cookie).toMatch(/session_token=/)
    expect(cookie).toMatch(/HttpOnly/i)
  })

  it('gives the same answer for a wrong password, an unknown address and a Google account', async () => {
    await built.signIn({ email: 'google-only@example.com', emailVerified: true })
    const answers = await Promise.all([
      built.post('/sign-in/email', { email, password: OTHER_PASSWORD }),
      built.post('/sign-in/email', { email: 'nobody@example.com', password: PASSWORD }),
      built.post('/sign-in/email', { email: 'google-only@example.com', password: PASSWORD }),
    ])
    for (const res of answers) {
      expect(res.statusCode).toBe(401)
      expect(res.headers['set-cookie']).toBeUndefined()
    }
    expect(new Set(answers.map((res) => res.body)).size).toBe(1)
  })

  it('limits how often one visitor can try', async () => {
    const visitor = { [CLIENT_ADDRESS_HEADER]: '203.0.113.41' }
    const statuses: number[] = []
    for (let i = 0; i < 11; i++) statuses.push((await built.post('/sign-in/email', { email, password: OTHER_PASSWORD }, visitor)).statusCode)
    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(401))
    expect(statuses[10]).toBe(429)
    // Even the right password waits, and another visitor is not affected.
    expect((await built.post('/sign-in/email', { email, password: PASSWORD }, visitor)).statusCode).toBe(429)
    expect((await built.post('/sign-in/email', { email, password: PASSWORD })).statusCode).toBe(200)
  })

  it('refuses a sign-in sent from another site', async () => {
    const res = await built.post('/sign-in/email', { email, password: PASSWORD }, {
      origin: 'https://evil.example',
      'sec-fetch-site': 'cross-site',
      'sec-fetch-mode': 'cors',
      'sec-fetch-dest': 'empty',
    })
    expect(res.statusCode).toBe(403)
    expect(res.headers['set-cookie']).toBeUndefined()
  })

  it('signs nobody in with a code alone', async () => {
    for (const path of ['/sign-in/email-otp', '/email-otp/verify-email', '/email-otp/send-verification-otp', '/sign-in/magic-link']) {
      expect((await built.post(path, { email, otp: '123456', type: 'sign-in' })).statusCode).toBe(404)
    }
  })
})

describe('resetting a password', () => {
  let built: Built
  beforeAll(async () => {
    built = await buildTestApp()
  })
  afterAll(() => built.app.close())

  const linkTo = (email: string) => built.mailTo(email).at(-1)?.text.match(/https:\/\/\S+\/reset-password#token=(\S+)/)
  const methods = (email: string) => {
    const id = built.memory.user.find((row) => row.email === email)?.id
    return built.memory.account.filter((row) => row.userId === id).map((row) => row.providerId)
  }

  it('mails a link to the dashboard, replaces the password and signs the account out everywhere', async () => {
    const email = 'forgetful@example.com'
    const { cookie } = await built.signUp(email, PASSWORD)

    const asked = await built.post('/request-password-reset', { email })
    expect(asked.statusCode).toBe(200)
    const link = linkTo(email)
    expect(link?.[0]).toMatch(new RegExp(`^${ORIGIN}/reset-password#token=`))
    const token = decodeURIComponent(link![1]!)

    const reset = await built.post('/reset-password', { token, newPassword: OTHER_PASSWORD })
    expect(reset.statusCode).toBe(200)
    expect(reset.headers['set-cookie']).toBeUndefined()

    expect((await built.post('/sign-in/email', { email, password: PASSWORD })).statusCode).toBe(401)
    expect((await built.post('/sign-in/email', { email, password: OTHER_PASSWORD })).statusCode).toBe(200)
    // The session from before the reset is gone on the server.
    expect((await built.app.inject({ method: 'GET', url: '/trpc/account.get', headers: { ...bearer, cookie } })).statusCode).toBe(401)
    // And the owner is told.
    expect(built.mailTo(email).at(-1)?.subject).toMatch(/password was changed/)
    expect(JSON.stringify(built.mail)).not.toContain(OTHER_PASSWORD)
  })

  it('a link works once', async () => {
    const email = 'one-link@example.com'
    await built.signUp(email, PASSWORD)
    await built.post('/request-password-reset', { email })
    const token = decodeURIComponent(linkTo(email)![1]!)
    expect((await built.post('/reset-password', { token, newPassword: OTHER_PASSWORD })).statusCode).toBe(200)
    expect((await built.post('/reset-password', { token, newPassword: PASSWORD })).statusCode).toBe(400)
    expect((await built.post('/sign-in/email', { email, password: OTHER_PASSWORD })).statusCode).toBe(200)
  })

  it('refuses a made-up link, and a new password that is too short keeps the link', async () => {
    const email = 'careful@example.com'
    await built.signUp(email, PASSWORD)
    expect((await built.post('/reset-password', { token: 'made-up-token', newPassword: OTHER_PASSWORD })).statusCode).toBe(400)

    await built.post('/request-password-reset', { email })
    const token = decodeURIComponent(linkTo(email)![1]!)
    expect((await built.post('/reset-password', { token, newPassword: TOO_SHORT })).statusCode).toBe(400)
    expect((await built.post('/sign-in/email', { email, password: PASSWORD })).statusCode).toBe(200)
    expect((await built.post('/reset-password', { token, newPassword: OTHER_PASSWORD })).statusCode).toBe(200)
  })

  it('answers the same for an address without an account, and mails nothing', async () => {
    const known = 'known@example.com'
    await built.signUp(known, PASSWORD)
    const [real, unknown] = await Promise.all([
      built.post('/request-password-reset', { email: known }),
      built.post('/request-password-reset', { email: 'unknown@example.com' }),
    ])
    expect(unknown.statusCode).toBe(200)
    expect(unknown.body).toBe(real.body)
    expect(built.mailTo('unknown@example.com')).toHaveLength(0)
  })

  it('gives an account made with Google no password: it is told how it signs in instead', async () => {
    const email = 'google-reset@example.com'
    await built.signIn({ email, emailVerified: true })

    expect((await built.post('/request-password-reset', { email })).statusCode).toBe(200)
    const notice = built.mailTo(email).at(-1)!
    expect(notice.subject).toMatch(/no password/)
    expect(notice.text).toMatch(/signs in with Google/)
    expect(notice.text).not.toContain('#token=')
    expect(methods(email)).toEqual(['google'])
  })

  it('does not serve the link Better Auth would mail, nor a redirect to another site', async () => {
    const email = 'redirected@example.com'
    await built.signUp(email, PASSWORD)
    const get = await built.app.inject({ method: 'GET', url: '/api/auth/reset-password/some-token?callbackURL=/reset-password', headers: bearer })
    expect(get.statusCode).toBe(404)
    const before = built.mailTo(email).length
    expect((await built.post('/request-password-reset', { email, redirectTo: 'https://evil.example/reset' })).statusCode).toBe(403)
    expect(built.mailTo(email)).toHaveLength(before)
  })

  it('limits how many links one visitor can ask for', async () => {
    const visitor = { [CLIENT_ADDRESS_HEADER]: '203.0.113.42' }
    const statuses: number[] = []
    for (let i = 0; i < 6; i++) {
      statuses.push((await built.post('/request-password-reset', { email: `reset-${i}@example.com` }, visitor)).statusCode)
    }
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429])
  })
})

describe('without a mail server', () => {
  let built: Built
  beforeAll(async () => {
    built = await buildTestApp({ email: false })
  })
  afterAll(() => built.app.close())

  it.each(EMAIL_PATHS)('does not serve %s', async (path) => {
    const res = await built.post(path, { email: 'anyone@example.com', password: PASSWORD, code: '123456', token: 'x', newPassword: PASSWORD })
    expect(res.statusCode).toBe(404)
  })

  it('says so to the sign-in page, and Google still works', async () => {
    const config = await built.app.inject({ method: 'GET', url: '/trpc/account.config', headers: bearer })
    expect(config.json()).toEqual({ result: { data: { providers: ['google', 'github'], email: false } } })
    expect((await built.signIn({ email: 'still-google@example.com', emailVerified: true })).cookie).toMatch(/session_token=/)
    expect(built.mail).toHaveLength(0)
  })

  it('refuses a password sign-in even when Better Auth is called directly', async () => {
    const res = await built.auth.handler(
      new Request(`${ORIGIN}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: ORIGIN },
        body: JSON.stringify({ email: 'anyone@example.com', password: PASSWORD }),
      }),
    )
    expect(res.status).toBe(404)
  })
})

describe('with email sign-in on', () => {
  it('tells the sign-in page', async () => {
    const built = await buildTestApp()
    const config = await built.app.inject({ method: 'GET', url: '/trpc/account.config', headers: bearer })
    expect(config.json()).toEqual({ result: { data: { providers: ['google', 'github'], email: true } } })
    await built.app.close()
  })
})
