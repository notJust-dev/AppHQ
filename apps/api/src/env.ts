import { z } from 'zod'

/** An optional variable, where an empty value counts as not set. */
const optional = <T extends z.ZodType>(type: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), type.optional())

/** Both halves of a pair, or neither: half a configuration is a mistake to report at boot. */
const pairs = [
  ['AUTH_GOOGLE_CLIENT_ID', 'AUTH_GOOGLE_CLIENT_SECRET'],
  ['AUTH_GITHUB_CLIENT_ID', 'AUTH_GITHUB_CLIENT_SECRET'],
  ['SMTP_HOST', 'MAIL_FROM'],
  ['SMTP_USER', 'SMTP_PASSWORD'],
] as const

/** A bare address, or `Name <address>`. */
const SENDER = /^(?:[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+|[^<>]*<[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+>)$/

/** A mail server on this machine: the only place mail may go without encryption. */
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    // Velocity's Nginx forwards to the app over IPv4 loopback, so never bind to `localhost`
    // (which Node may resolve to ::1).
    HOST: z.string().default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    // Local development sets DATABASE_URL. On Velocity, attaching PostgreSQL to the app injects
    // the standard PGHOST, PGPORT, PGDATABASE, PGUSER and PGPASSWORD variables instead, which
    // the Postgres driver reads on its own.
    DATABASE_URL: z.url().optional(),
    PGHOST: z.string().optional(),
    PGDATABASE: z.string().optional(),
    PGUSER: z.string().optional(),
    // Hours between the syncs the API starts by itself (see sync/schedule.ts); 0 turns them off.
    SYNC_EVERY_HOURS: z.coerce.number().min(0).max(24).default(3),
    INTERNAL_API_TOKEN: z.string().min(32, 'must be at least 32 characters'),
    // Encrypts API keys and OAuth tokens stored in the database. Optional so that the API still
    // boots without it; connecting a source then fails with a clear message.
    // Generate with: openssl rand -hex 32
    ENCRYPTION_KEY: z
      .string()
      .regex(/^[0-9a-f]{64}$/i, 'must be 64 hex characters')
      .optional(),
    // From the TikTok app, or its sandbox, which has its own pair. Optional: without them the
    // dashboard explains what to set instead of offering "Connect TikTok".
    TIKTOK_CLIENT_KEY: z.string().optional(),
    TIKTOK_CLIENT_SECRET: z.string().optional(),
    // From the Meta app (App settings, Basic) and its Facebook Login for Business configuration.
    META_APP_ID: z.string().optional(),
    META_APP_SECRET: z.string().optional(),
    META_LOGIN_CONFIG_ID: z.string().optional(),
    // The dashboard's public address (the web app, not this API), e.g. https://apphq.example.com:
    // the same value as PUBLIC_URL on the web app. Accounts need it: people sign in there, and it
    // forwards /api/auth to this API. An origin only, with no path.
    PUBLIC_URL: optional(
      z.url({ protocol: /^https?$/ }).refine((value) => new URL(value).pathname === '/', 'must be an origin, with no path'),
    ),
    // Whether this API accepts the web app's statement that the visitor signed in with the
    // dashboard password (DASHBOARD_PASSWORD on the web app). On unless set to `false`, so
    // existing installs keep working. Set it to `false` once you sign in with an account: a
    // password left set on the web app then opens nothing. Only `true` or `false`, so a typo
    // stops the API instead of leaving the password on.
    ALLOW_DASHBOARD_PASSWORD: optional(z.enum(['true', 'false'], 'must be true or false'))
      .default('true')
      .transform((value) => value === 'true'),
    // Accounts, optional (see "Accounts and access requests" in the README). Off unless the
    // secret, PUBLIC_URL and at least one way to sign in are set: Google, GitHub, or a mail
    // server for signing up with an email address. An approved account opens the dashboard in
    // the organizations it belongs to.
    BETTER_AUTH_SECRET: optional(z.string().min(32, 'must be at least 32 characters')),
    AUTH_GOOGLE_CLIENT_ID: optional(z.string()),
    AUTH_GOOGLE_CLIENT_SECRET: optional(z.string()),
    AUTH_GITHUB_CLIENT_ID: optional(z.string()),
    AUTH_GITHUB_CLIENT_SECRET: optional(z.string()),
    // Signing up with an email address and a password, optional. It needs a mail server, for the
    // confirmation code and the password reset link: any provider's SMTP server works. On when
    // SMTP_HOST and MAIL_FROM are set (see "Signing up with an email address" in the README).
    SMTP_HOST: optional(z.string()),
    // Default 465, or the usual port for SMTP_TLS.
    SMTP_PORT: optional(z.coerce.number().int().min(1).max(65535)),
    // How the connection is protected: `implicit` (TLS from the start, port 465), `starttls`
    // (upgraded before anything is sent, port 587) or `none`. Default: by the port. `none` is
    // refused for any host but this machine, so mail and the SMTP password never travel in the
    // clear.
    SMTP_TLS: optional(z.enum(['implicit', 'starttls', 'none'], 'must be implicit, starttls or none')),
    SMTP_USER: optional(z.string()),
    SMTP_PASSWORD: optional(z.string()),
    // The sender: `AppHQ <no-reply@apphq.example.com>`, on a domain the mail server may send for.
    MAIL_FROM: optional(z.string().regex(SENDER, 'must be an address, or "Name <address>"')),
    // Optional: where replies go, when that is not the sender.
    MAIL_REPLY_TO: optional(z.email('must be an email address')),
    // Error reporting, optional: a Sentry DSN, or one from anything that speaks Sentry's protocol
    // (GlitchTip, a self-hosted Sentry). Off unless set; see lib/errors.ts for what is sent.
    SENTRY_DSN: optional(z.url({ protocol: /^https?$/ })),
    // The environment errors are filed under. Default: NODE_ENV.
    SENTRY_ENVIRONMENT: optional(z.string()),
  })
  .refine((env) => env.DATABASE_URL || (env.PGHOST && env.PGDATABASE && env.PGUSER), {
    path: ['DATABASE_URL'],
    message: 'set DATABASE_URL, or the PGHOST, PGDATABASE and PGUSER variables',
  })
  .superRefine((env, ctx) => {
    for (const [a, b] of pairs) {
      if ((env[a] === undefined) !== (env[b] === undefined)) {
        ctx.addIssue({ code: 'custom', path: [env[a] === undefined ? a : b], message: `set together with ${env[a] === undefined ? b : a}` })
      }
    }
    // PUBLIC_URL alone is fine; the secret or a way to sign in without the rest is half an
    // accounts setup.
    const signIn = env.AUTH_GOOGLE_CLIENT_ID || env.AUTH_GITHUB_CLIENT_ID || env.SMTP_HOST
    if ((signIn || env.BETTER_AUTH_SECRET) && !env.PUBLIC_URL) {
      ctx.addIssue({ code: 'custom', path: ['PUBLIC_URL'], message: 'accounts need the dashboard\'s public address here too' })
    }
    if (signIn && !env.BETTER_AUTH_SECRET) {
      ctx.addIssue({ code: 'custom', path: ['BETTER_AUTH_SECRET'], message: 'a way to sign in is set, so set BETTER_AUTH_SECRET too' })
    }
    for (const name of ['SMTP_PORT', 'SMTP_TLS', 'SMTP_USER', 'MAIL_REPLY_TO'] as const) {
      if (env[name] !== undefined && !env.SMTP_HOST) {
        ctx.addIssue({ code: 'custom', path: ['SMTP_HOST'], message: `${name} is set, so set SMTP_HOST too` })
      }
    }
    if (env.SMTP_TLS === 'none' && env.SMTP_HOST && !LOOPBACK.has(env.SMTP_HOST.toLowerCase())) {
      ctx.addIssue({ code: 'custom', path: ['SMTP_TLS'], message: 'none is only for a mail catcher on this machine (127.0.0.1 or localhost)' })
    }
  })

export type Env = z.infer<typeof schema>

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source)
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n')
    throw new Error(`Invalid environment variables:\n${problems}`)
  }
  return parsed.data
}
