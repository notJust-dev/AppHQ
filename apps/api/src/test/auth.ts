import { memoryAdapter } from 'better-auth/adapters/memory'
import type { BetterAuthOptions } from 'better-auth'
import { buildApp } from '../app.js'
import { createAccounts } from '../auth/accounts.js'
import { CLIENT_ADDRESS_HEADER, authOptions, authPaths, createAuth, type AuthConfig } from '../auth/auth.js'
import type { Db, Sql } from '../db/client.js'
import { createSecrets } from '../lib/crypto.js'
import type { Logger } from '../lib/logger.js'
import type { Mailer, MailMessage } from '../mail/mailer.js'

export const TOKEN = 'test-token-that-is-at-least-32-characters'
export const ORIGIN = 'https://apphq.example.com'

/** The organization the test app's dashboard password works in. Invented. */
export const TEST_DASHBOARD_ORGANIZATION = '00000000-0000-4000-8000-00000000d0d0'

export const CONFIG: AuthConfig = {
  secret: 'test-secret-that-is-at-least-32-characters',
  url: ORIGIN,
  google: { clientId: 'test-google-client-id', clientSecret: 'test-google-client-secret' },
  github: { clientId: 'test-github-client-id', clientSecret: 'test-github-client-secret' },
  // Never connected to: the test app sends through a mailer that only keeps the messages.
  mail: { host: 'smtp.example.com', port: 465, tls: 'implicit', from: 'AppHQ <no-reply@apphq.example.com>' },
}

/** The same accounts without a mail server, so without email sign-in. */
export const CONFIG_WITHOUT_MAIL: AuthConfig = { ...CONFIG, mail: undefined }

const silent: Logger = { info() {}, warn() {}, error() {} }

/** Any use of the database fails loudly: these tests never get that far, or must not. */
export const unreachableDb = new Proxy(
  {},
  {
    get() {
      throw new Error('the database is not used in this test')
    },
  },
) as Db

/** What the stand-in for Google says about the person signing in. */
export interface TestProfile {
  email: string
  emailVerified: boolean
  name?: string
  /** Anything else a provider might send, such as fields the person should not control. */
  extra?: Record<string, unknown>
}

/**
 * The production options, except that Google accepts an ID token the test makes up: the token
 * is the profile itself, so a test can sign anyone in without a network. Everything else, such
 * as which fields may be set and which paths are open, is exactly as in production.
 */
export function testAuthOptions(
  database: BetterAuthOptions['database'],
  config: AuthConfig = CONFIG,
  deps: { mailer?: Mailer; log?: Logger } = {},
) {
  const options = authOptions(config, database, { log: silent, ...deps })
  return {
    ...options,
    socialProviders: {
      ...options.socialProviders,
      google: {
        ...options.socialProviders.google!,
        disableIdTokenSignIn: false,
        verifyIdToken: async () => true,
        getUserInfo: async (tokens: { idToken?: string }) => {
          const profile = JSON.parse(Buffer.from(tokens.idToken ?? '', 'base64url').toString('utf8')) as TestProfile
          return {
            user: {
              id: `google-${profile.email}`,
              email: profile.email,
              emailVerified: profile.emailVerified,
              name: profile.name ?? 'Test Person',
              ...profile.extra,
            },
            // Google's own profile; Better Auth takes the account id from `sub`.
            data: { sub: `google-${profile.email}`, email: profile.email, email_verified: profile.emailVerified },
          }
        },
      },
    },
  }
}

let addressCounter = 0
/** A different documentation address (RFC 5737) for each sign-in, so rate limits don't interfere. */
export const nextAddress = () => `198.51.100.${(addressCounter++ % 250) + 1}`

/** The app with accounts on, on an in-memory store unless another is given. */
export async function buildTestApp(
  options: {
    db?: Db
    accounts?: boolean
    database?: BetterAuthOptions['database']
    /** `ALLOW_DASHBOARD_PASSWORD`; on unless a test turns it off. */
    allowDashboardPassword?: boolean
    /** Email sign-in; on unless a test turns it off. */
    email?: boolean
  } = {},
) {
  const config = options.email === false ? CONFIG_WITHOUT_MAIL : CONFIG
  /** Every message the app sent, oldest first, instead of a mail server. */
  const mail: MailMessage[] = []
  const mailer: Mailer = { send: async (message) => void mail.push(message) }
  type Rows = Record<string, unknown>[]
  const memory: Record<'user' | 'session' | 'account' | 'verification' | 'organization' | 'member' | 'invitation', Rows> = {
    user: [],
    session: [],
    account: [],
    verification: [],
    organization: [],
    member: [],
    invitation: [],
  }
  const auth = createAuth(testAuthOptions(options.database ?? memoryAdapter(memory), config, { mailer }) as ReturnType<typeof authOptions>)
  const app = await buildApp({
    db: options.db ?? unreachableDb,
    sql: {} as Sql,
    secrets: createSecrets(undefined),
    pingDb: async () => 1,
    internalApiToken: TOKEN,
    allowDashboardPassword: options.allowDashboardPassword ?? true,
    // A real database resolves this from the `organization` table; see organizations/dashboard.ts.
    dashboardOrganization: options.db ? undefined : async () => TEST_DASHBOARD_ORGANIZATION,
    accounts: options.accounts === false ? null : { auth, origin: ORIGIN, accounts: createAccounts(auth, config), paths: authPaths(config) },
    logLevel: 'silent',
  })
  type App = typeof app

  /** Signs someone in through the real endpoint; `cookie` is what their browser would send next. */
  async function signIn(profile: TestProfile) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/social',
      headers: {
        authorization: `Bearer ${TOKEN}`,
        origin: ORIGIN,
        'content-type': 'application/json',
        [CLIENT_ADDRESS_HEADER]: nextAddress(),
      },
      payload: JSON.stringify({
        provider: 'google',
        idToken: { token: Buffer.from(JSON.stringify(profile)).toString('base64url') },
      }),
    })
    const body = res.json() as { user?: { id: string } }
    return { res, cookie: cookieFrom(res.headers['set-cookie']), userId: body.user?.id }
  }

  /** A POST to /api/auth as the dashboard server forwards one from a browser on the dashboard. */
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    app.inject({
      method: 'POST',
      url: `/api/auth${path}`,
      headers: {
        authorization: `Bearer ${TOKEN}`,
        origin: ORIGIN,
        'content-type': 'application/json',
        [CLIENT_ADDRESS_HEADER]: nextAddress(),
        ...headers,
      },
      payload: JSON.stringify(body),
    })

  /** The messages sent to one address, oldest first. */
  const mailTo = (email: string) => mail.filter((message) => message.to === email.toLowerCase())

  /** The six-digit code in the last message to the address; fails the test when there is none. */
  const lastCode = (email: string) => {
    const code = mailTo(email).at(-1)?.text.match(/^\d{6}$/m)?.[0]
    if (!code) throw new Error(`no code was mailed to ${email}`)
    return code
  }

  /** Signs someone up with an email address and a password, through the real endpoints. */
  async function signUp(email: string, password: string) {
    await post('/email-sign-up/send-code', { email })
    const res = await post('/email-sign-up/confirm', { email, code: lastCode(email), password })
    return { res, cookie: cookieFrom(res.headers['set-cookie']) }
  }

  return { app: app as App, auth, memory, signIn, mail, mailTo, lastCode, post, signUp }
}

/** The Cookie header a browser would send back after these Set-Cookie headers. */
export function cookieFrom(setCookie: string | string[] | undefined): string {
  const list = setCookie === undefined ? [] : Array.isArray(setCookie) ? setCookie : [setCookie]
  return list
    .map((line) => line.split(';')[0] ?? '')
    .filter((pair) => pair.length > 0 && !pair.endsWith('='))
    .join('; ')
}
