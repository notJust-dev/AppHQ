import { z } from 'zod'

/** An optional variable, where an empty value counts as not set. */
const optional = <T extends z.ZodType>(type: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), type.optional())

/** Both halves of a pair, or neither: half a configuration is a mistake to report at boot. */
const pairs = [
  ['BETTER_AUTH_SECRET', 'BETTER_AUTH_URL'],
  ['AUTH_GOOGLE_CLIENT_ID', 'AUTH_GOOGLE_CLIENT_SECRET'],
  ['AUTH_GITHUB_CLIENT_ID', 'AUTH_GITHUB_CLIENT_SECRET'],
] as const

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
    // Accounts, optional (see "Accounts and access requests" in the README). Off unless the
    // secret, the dashboard's address and at least one sign-in provider are set. An account
    // never opens the dashboard, which still takes DASHBOARD_PASSWORD on the web app.
    BETTER_AUTH_SECRET: optional(z.string().min(32, 'must be at least 32 characters')),
    // The dashboard's public address, e.g. https://apphq.example.com: people sign in there, and
    // it forwards /api/auth to this API. An origin only, with no path.
    BETTER_AUTH_URL: optional(
      z.url({ protocol: /^https?$/ }).refine((value) => new URL(value).pathname === '/', 'must be an origin, with no path'),
    ),
    AUTH_GOOGLE_CLIENT_ID: optional(z.string()),
    AUTH_GOOGLE_CLIENT_SECRET: optional(z.string()),
    AUTH_GITHUB_CLIENT_ID: optional(z.string()),
    AUTH_GITHUB_CLIENT_SECRET: optional(z.string()),
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
    const provider = env.AUTH_GOOGLE_CLIENT_ID || env.AUTH_GITHUB_CLIENT_ID
    if (provider && !env.BETTER_AUTH_SECRET && !env.BETTER_AUTH_URL) {
      ctx.addIssue({ code: 'custom', path: ['BETTER_AUTH_SECRET'], message: 'a sign-in provider is set, so set BETTER_AUTH_SECRET and BETTER_AUTH_URL too' })
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
