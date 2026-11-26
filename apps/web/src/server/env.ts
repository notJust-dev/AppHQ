import '@tanstack/react-start/server-only'
import { z } from 'zod'

const schema = z.object({
  API_URL: z.url(),
  INTERNAL_API_TOKEN: z.string().min(32, 'must be at least 32 characters'),
  SESSION_SECRET: z.string().min(32, 'must be at least 32 characters'),
  // Optional: without it (or with it empty) the password is off, and only accounts open the
  // dashboard. See password.ts.
  DASHBOARD_PASSWORD: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().min(12, 'must be at least 12 characters').optional(),
  ),
})

let cached: z.infer<typeof schema> | undefined
let reported = false

/** True when every required variable is present and valid. */
export function isServerConfigured(): boolean {
  return cached !== undefined || schema.safeParse(process.env).success
}

/**
 * Server-side configuration. Read lazily, per request, so nothing is evaluated at import.
 *
 * Errors thrown on the server are serialized into the page for the client, so the error thrown
 * here is deliberately vague. Which variables are wrong goes to the server log only.
 */
export function serverEnv() {
  if (cached) return cached
  const parsed = schema.safeParse(process.env)
  if (!parsed.success) {
    if (!reported) {
      reported = true
      const problems = parsed.error.issues
        .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
        .join('\n')
      console.error(`Invalid environment variables:\n${problems}`)
    }
    throw new Error('The dashboard server is not fully configured.')
  }
  cached = parsed.data
  return cached
}
