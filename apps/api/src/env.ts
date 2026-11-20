import { z } from 'zod'

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
    INTERNAL_API_TOKEN: z.string().min(32, 'must be at least 32 characters'),
    // Encrypts API keys and OAuth tokens stored in the database. Optional so that the API still
    // boots without it; connecting a source then fails with a clear message.
    // Generate with: openssl rand -hex 32
    ENCRYPTION_KEY: z
      .string()
      .regex(/^[0-9a-f]{64}$/i, 'must be 64 hex characters')
      .optional(),
  })
  .refine((env) => env.DATABASE_URL || (env.PGHOST && env.PGDATABASE && env.PGUSER), {
    path: ['DATABASE_URL'],
    message: 'set DATABASE_URL, or the PGHOST, PGDATABASE and PGUSER variables',
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
