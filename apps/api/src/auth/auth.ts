import { betterAuth, type BetterAuthOptions } from 'better-auth'
import { organization } from 'better-auth/plugins'
import type { Env } from '../env.js'
import { consoleLogger, type Logger } from '../lib/logger.js'
import { mailConfigFromEnv } from '../mail/config.js'
import { createSmtpMailer, type Mailer, type SmtpConfig } from '../mail/mailer.js'
import { createOutbox } from '../mail/outbox.js'
import { EMAIL_PATHS, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, RESET_MINUTES, emailAccounts } from './email.js'

/**
 * Accounts, with Better Auth. People sign in with Google or GitHub, or sign up with an email
 * address and a password, and can ask for access. Once approved, an account opens the dashboard
 * in the organizations it belongs to. Nothing here decides dashboard access; see `trpc/init.ts`.
 */

export type SocialProvider = 'google' | 'github'

export interface AuthConfig {
  secret: string
  /** The dashboard's public origin. Sign-in starts and ends there; it forwards /api/auth here. */
  url: string
  google?: { clientId: string; clientSecret: string }
  github?: { clientId: string; clientSecret: string }
  /**
   * The mail server. With one, people can sign up with an email address and a password (see
   * `email.ts`); it sends the confirmation code and the password reset link.
   */
  mail?: SmtpConfig
}

/**
 * The visitor's address, put there by the dashboard server, which replaces anything the visitor
 * sent. Only the dashboard server can reach /api/auth (it needs the internal token), so the rate
 * limiter can trust it. Must match `CLIENT_ADDRESS_HEADER` in apps/web/src/server/accounts.ts.
 */
export const CLIENT_ADDRESS_HEADER = 'x-apphq-client-address'

const SOCIAL_PATHS = ['/sign-in/social', '/callback/google', '/callback/github', '/sign-out']

/**
 * The only Better Auth endpoints reachable over HTTP, under /api/auth. Profile updates, linking,
 * changing a password while signed in and session listing are not needed and stay unreachable,
 * whatever a later version of the library adds. The email endpoints are served only when email
 * sign-in is on. The dashboard forwards the same list.
 */
export function authPaths(config: AuthConfig): ReadonlySet<string> {
  return new Set([...SOCIAL_PATHS, ...(config.mail ? EMAIL_PATHS : [])])
}

/** The accounts configuration from the environment, or null when accounts are off. */
export function authConfigFromEnv(env: Env): AuthConfig | null {
  if (!env.BETTER_AUTH_SECRET || !env.PUBLIC_URL) return null
  const pair = (id?: string, secret?: string) => (id && secret ? { clientId: id, clientSecret: secret } : undefined)
  const google = pair(env.AUTH_GOOGLE_CLIENT_ID, env.AUTH_GOOGLE_CLIENT_SECRET)
  const github = pair(env.AUTH_GITHUB_CLIENT_ID, env.AUTH_GITHUB_CLIENT_SECRET)
  const mail = mailConfigFromEnv(env) ?? undefined
  if (!google && !github && !mail) return null
  return { secret: env.BETTER_AUTH_SECRET, url: new URL(env.PUBLIC_URL).origin, google, github, mail }
}

export function providersOf(config: AuthConfig): SocialProvider[] {
  return [...(config.google ? (['google'] as const) : []), ...(config.github ? (['github'] as const) : [])]
}

const THIRTY_DAYS = 60 * 60 * 24 * 30

/** Also refused by the router in `routes.ts`; listed so a direct call can't reach them either. */
const DISABLED_PATHS = [
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
]

/**
 * Every option that matters is set here rather than left to a default, because several of Better
 * Auth's defaults depend on NODE_ENV, which the deployment leaves unset.
 *
 * `deps.mailer` replaces the mail server in tests; `deps.log` is where mail problems are reported.
 */
export function authOptions(
  config: AuthConfig,
  database: BetterAuthOptions['database'],
  deps: { mailer?: Mailer; log?: Logger } = {},
) {
  const origin = new URL(config.url).origin
  const served = authPaths(config)
  const outbox = config.mail ? createOutbox(deps.mailer ?? createSmtpMailer(config.mail), deps.log ?? consoleLogger) : null
  return {
    appName: 'AppHQ',
    baseURL: origin,
    basePath: '/api/auth',
    secret: config.secret,
    trustedOrigins: [origin],
    database,
    telemetry: { enabled: false },
    emailAndPassword: outbox
      ? {
          enabled: true,
          // Accounts are made by `/email-sign-up/confirm` only, once the address is confirmed.
          disableSignUp: true,
          // No session for an address that is not confirmed. Accounts with a password always
          // are; this holds even if one were not.
          requireEmailVerification: true,
          minPasswordLength: MIN_PASSWORD_LENGTH,
          maxPasswordLength: MAX_PASSWORD_LENGTH,
          resetPasswordTokenExpiresIn: RESET_MINUTES * 60,
          // Whoever knew the old password is signed out when it is replaced.
          revokeSessionsOnPasswordReset: true,
        }
      : { enabled: false },
    plugins: [organizationPlugin(), ...(outbox ? [emailAccounts({ outbox, origin })] : [])],
    socialProviders: {
      ...(config.google && {
        google: {
          ...config.google,
          prompt: 'select_account' as const,
          // Ask for name and email only, never with what the person granted the YouTube
          // connector before, even when both use the same Google Cloud project.
          includeGrantedScopes: false,
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
        // Per visitor address. Guessing a password or a code is slow from one address, and the
        // forms that send mail can't be run in a loop; each address they mail has its own
        // limit too (mail/outbox.ts).
        '/sign-in/email': { window: 600, max: 10 },
        '/email-sign-up/send-code': { window: 600, max: 5 },
        '/email-sign-up/confirm': { window: 600, max: 10 },
        '/request-password-reset': { window: 3600, max: 5 },
        '/reset-password': { window: 600, max: 10 },
      },
    },
    // Errors go to the Request access page, which shows its own words for known codes. Better
    // Auth's error page is not reachable.
    onAPIError: { errorURL: `${origin}/request-access` },
    disabledPaths: DISABLED_PATHS.filter((path) => !served.has(path)),
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
 * over HTTP (none of its paths is in `authPaths`), and people can neither create nor delete
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
