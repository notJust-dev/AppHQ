import { betterAuth, type BetterAuthOptions } from 'better-auth'
import { organization } from 'better-auth/plugins'
import type { Env } from '../env.js'

/**
 * Accounts, with Better Auth. People sign in with Google or GitHub and can ask for access. An
 * account opens nothing else: the dashboard still takes the dashboard password, which the web app
 * checks. Nothing here decides dashboard access; see `trpc/init.ts`.
 */

export type SocialProvider = 'google' | 'github'

export interface AuthConfig {
  secret: string
  /** The dashboard's public origin. Sign-in starts and ends there; it forwards /api/auth here. */
  url: string
  google?: { clientId: string; clientSecret: string }
  github?: { clientId: string; clientSecret: string }
}

/**
 * The visitor's address, put there by the dashboard server, which replaces anything the visitor
 * sent. Only the dashboard server can reach /api/auth (it needs the internal token), so the rate
 * limiter can trust it. Must match `CLIENT_ADDRESS_HEADER` in apps/web/src/server/accounts.ts.
 */
export const CLIENT_ADDRESS_HEADER = 'x-apphq-client-address'

/**
 * The only Better Auth endpoints reachable over HTTP, under /api/auth. Profile updates, linking,
 * passwords and session listing are not needed and stay unreachable, whatever a later version of
 * the library adds. The dashboard forwards the same list.
 */
export const AUTH_PATHS: ReadonlySet<string> = new Set([
  '/sign-in/social',
  '/callback/google',
  '/callback/github',
  '/sign-out',
])

/** The accounts configuration from the environment, or null when accounts are off. */
export function authConfigFromEnv(env: Env): AuthConfig | null {
  if (!env.BETTER_AUTH_SECRET || !env.BETTER_AUTH_URL) return null
  const pair = (id?: string, secret?: string) => (id && secret ? { clientId: id, clientSecret: secret } : undefined)
  const google = pair(env.AUTH_GOOGLE_CLIENT_ID, env.AUTH_GOOGLE_CLIENT_SECRET)
  const github = pair(env.AUTH_GITHUB_CLIENT_ID, env.AUTH_GITHUB_CLIENT_SECRET)
  if (!google && !github) return null
  return { secret: env.BETTER_AUTH_SECRET, url: new URL(env.BETTER_AUTH_URL).origin, google, github }
}

export function providersOf(config: AuthConfig): SocialProvider[] {
  return [...(config.google ? (['google'] as const) : []), ...(config.github ? (['github'] as const) : [])]
}

const THIRTY_DAYS = 60 * 60 * 24 * 30

/**
 * Every option that matters is set here rather than left to a default, because several of Better
 * Auth's defaults depend on NODE_ENV, which the deployment leaves unset.
 */
export function authOptions(config: AuthConfig, database: BetterAuthOptions['database']) {
  const origin = new URL(config.url).origin
  return {
    appName: 'AppHQ',
    baseURL: origin,
    basePath: '/api/auth',
    secret: config.secret,
    trustedOrigins: [origin],
    database,
    telemetry: { enabled: false },
    emailAndPassword: { enabled: false },
    plugins: [organizationPlugin()],
    socialProviders: {
      ...(config.google && {
        google: {
          ...config.google,
          prompt: 'select_account' as const,
          // Only the redirect sign-in is used.
          disableIdTokenSignIn: true,
          // An address the provider has not verified gets no session.
          requireEmailVerification: true,
        },
      }),
      ...(config.github && { github: { ...config.github, requireEmailVerification: true } }),
    },
    account: {
      // A second sign-in method never joins an existing account, so nobody can reach someone
      // else's account through a provider that vouches for the same address.
      accountLinking: { enabled: false },
      // The provider tokens are never used; encrypted in case that changes.
      encryptOAuthTokens: true,
      // The sign-in state travels in an encrypted cookie, so starting a sign-in writes nothing.
      storeStateStrategy: 'cookie' as const,
    },
    user: {
      additionalFields: {
        // Server-only: Better Auth refuses them from sign-up, profile updates and provider data.
        accessStatus: { type: 'string', required: false, input: false },
        accessRequestedAt: { type: 'date', required: false, input: false },
      },
      changeEmail: { enabled: false },
      deleteUser: { enabled: false },
    },
    session: {
      expiresIn: THIRTY_DAYS,
      updateAge: 60 * 60 * 24,
      // Always read from the database, so a deleted session stops working at once.
      cookieCache: { enabled: false },
    },
    rateLimit: {
      enabled: true,
      storage: 'memory' as const,
      window: 60,
      max: 60,
      customRules: {
        '/sign-in/social': { window: 60, max: 10 },
        '/callback/*': { window: 60, max: 20 },
      },
    },
    // Errors go to the Request access page, which shows its own words for known codes. Better
    // Auth's error page is not reachable.
    onAPIError: { errorURL: `${origin}/request-access` },
    // Also refused by the router in `routes.ts`; listed so a direct call can't reach them either.
    disabledPaths: [
      '/sign-in/email',
      '/sign-up/email',
      '/update-user',
      '/change-email',
      '/change-password',
      '/delete-user',
      '/delete-user/callback',
      '/update-session',
      '/link-social',
      '/unlink-account',
      '/list-accounts',
      '/account-info',
      '/get-access-token',
      '/refresh-token',
      '/list-sessions',
      '/revoke-session',
      '/revoke-sessions',
      '/revoke-other-sessions',
      '/verify-password',
      '/request-password-reset',
      '/reset-password',
      '/send-verification-email',
      '/verify-email',
      '/error',
    ],
    advanced: {
      database: { generateId: 'uuid' as const },
      useSecureCookies: origin.startsWith('https://'),
      ipAddress: { ipAddressHeaders: [CLIENT_ADDRESS_HEADER] },
      // Explicit, because Better Auth turns the origin check off when NODE_ENV is "test".
      disableCSRFCheck: false,
      disableOriginCheck: false,
    },
    databaseHooks: {
      user: {
        create: {
          // A provider's display name is shown back to its owner only; keep it a sane length.
          before: async (data: { name?: unknown }) => ({
            data: { ...data, name: typeof data.name === 'string' ? data.name.slice(0, 200) : '' },
          }),
        },
      },
      session: {
        create: {
          // The address is used for rate limits only and the privacy page says it is never
          // stored, so sessions keep neither it nor the browser's name.
          before: async (data: Record<string, unknown>) => ({ data: { ...data, ipAddress: null, userAgent: null } }),
        },
      },
    },
  } satisfies BetterAuthOptions
}

/**
 * Better Auth's organization plugin, for its tables and session field. Nothing of it is reachable
 * over HTTP (none of its paths is in `AUTH_PATHS`), and people can neither create nor delete
 * organizations through it: the API makes them itself (src/organizations/ensure.ts).
 */
export const organizationPlugin = () =>
  organization({
    allowUserToCreateOrganization: false,
    disableOrganizationDeletion: true,
    // For the invitations to come: only the verified owner of an address may accept one.
    requireEmailVerificationOnInvitation: true,
  })

export function createAuth(options: ReturnType<typeof authOptions>) {
  return betterAuth(options)
}

export type Auth = ReturnType<typeof createAuth>
