import '@tanstack/react-start/server-only'
import { getRequestHeader } from '@tanstack/react-start/server'
import { serverEnv } from './env'
import { createPasswordChecker, type PasswordResult } from './password-session'

export type { PasswordResult } from './password-session'

export function clientAddress(): string {
  // Velocity sits behind Cloudflare, which sets cf-connecting-ip.
  return (
    getRequestHeader('cf-connecting-ip') ??
    getRequestHeader('x-forwarded-for')?.split(',')[0]?.trim() ??
    'local'
  )
}

/**
 * Whether this server has a dashboard password. It is optional: without DASHBOARD_PASSWORD the
 * sign-in page shows no password field, and only accounts open the dashboard.
 */
export function passwordEnabled(): boolean {
  return serverEnv().DASHBOARD_PASSWORD !== undefined
}

const check = createPasswordChecker()

/** Checks the dashboard password in constant time and slows down repeated guessing. */
export function checkPassword(candidate: string, now: number = Date.now()): PasswordResult {
  return check(candidate, serverEnv().DASHBOARD_PASSWORD, clientAddress(), now)
}
