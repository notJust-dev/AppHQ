import '@tanstack/react-start/server-only'

/**
 * Error reporting from the browser is off unless SENTRY_DSN is set, so a self-hosted copy never
 * reports to anyone. Read at runtime, not at build time, so turning it on needs no rebuild.
 * A DSN only lets someone send events, so the browser may see it.
 */
export type ErrorReportingConfig = { dsn: string; environment: string } | null

export function errorReportingConfig(): ErrorReportingConfig {
  const dsn = process.env.SENTRY_DSN?.trim()
  if (!dsn) return null
  try {
    if (!/^https?:$/.test(new URL(dsn).protocol)) throw new Error()
  } catch {
    console.error('SENTRY_DSN is not an http(s) address, so error reporting is off')
    return null
  }
  const environment = process.env.SENTRY_ENVIRONMENT?.trim() || process.env.NODE_ENV || 'production'
  return { dsn, environment }
}
