import { memoryAdapter } from 'better-auth/adapters/memory'
import type { BetterAuthOptions } from 'better-auth'
import { buildApp } from '../app.js'
import { createAccounts } from '../auth/accounts.js'
import { CLIENT_ADDRESS_HEADER, authOptions, createAuth, type AuthConfig } from '../auth/auth.js'
import type { Db, Sql } from '../db/client.js'
import { createSecrets } from '../lib/crypto.js'

export const TOKEN = 'test-token-that-is-at-least-32-characters'
export const ORIGIN = 'https://apphq.example.com'

export const CONFIG: AuthConfig = {
  secret: 'test-secret-that-is-at-least-32-characters',
  url: ORIGIN,
  google: { clientId: 'test-google-client-id', clientSecret: 'test-google-client-secret' },
  github: { clientId: 'test-github-client-id', clientSecret: 'test-github-client-secret' },
}

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
export function testAuthOptions(database: BetterAuthOptions['database'], config: AuthConfig = CONFIG) {
  const options = authOptions(config, database)
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
  options: { db?: Db; accounts?: boolean; database?: BetterAuthOptions['database'] } = {},
) {
  type Rows = Record<string, unknown>[]
  const memory: { user: Rows; session: Rows; account: Rows; verification: Rows } = { user: [], session: [], account: [], verification: [] }
  const auth = createAuth(testAuthOptions(options.database ?? memoryAdapter(memory)) as ReturnType<typeof authOptions>)
  const app = await buildApp({
    db: options.db ?? unreachableDb,
    sql: {} as Sql,
    secrets: createSecrets(undefined),
    pingDb: async () => 1,
    internalApiToken: TOKEN,
    accounts: options.accounts === false ? null : { auth, origin: ORIGIN, accounts: createAccounts(auth, CONFIG) },
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

  return { app: app as App, auth, memory, signIn }
}

/** The Cookie header a browser would send back after these Set-Cookie headers. */
export function cookieFrom(setCookie: string | string[] | undefined): string {
  const list = setCookie === undefined ? [] : Array.isArray(setCookie) ? setCookie : [setCookie]
  return list
    .map((line) => line.split(';')[0] ?? '')
    .filter((pair) => pair.length > 0 && !pair.endsWith('='))
    .join('; ')
}
