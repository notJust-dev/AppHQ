import '@tanstack/react-start/server-only'
import { z } from 'zod'

const schema = z.object({
  API_URL: z.url(),
  INTERNAL_API_TOKEN: z.string().min(32, 'must be at least 32 characters'),
  SESSION_SECRET: z.string().min(32, 'must be at least 32 characters'),
  DASHBOARD_PASSWORD: z.string().min(12, 'must be at least 12 characters'),
})

let cached: z.infer<typeof schema> | undefined

/** Server-side configuration. Read lazily, per request, so nothing is evaluated at import. */
export function serverEnv() {
  if (cached) return cached
  const parsed = schema.safeParse(process.env)
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n')
    throw new Error(`Invalid environment variables:\n${problems}`)
  }
  cached = parsed.data
  return cached
}
