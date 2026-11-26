import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

/**
 * The dashboard password's rules, without any request or cookie handling, so they can be tested
 * on their own. `password.ts` and `access.ts` apply them to the current request.
 */

/** Keeps this HMAC apart from anything else ever keyed with the session secret. */
const LABEL = 'apphq dashboard password session v1\0'

/**
 * What a password session stores instead of "signed in": an HMAC of the current password, keyed
 * with SESSION_SECRET. It reveals nothing about the password, and it only matches while that
 * password is set, so changing or unsetting the password ends every password session.
 */
export function passwordFingerprint(password: string, sessionSecret: string): string {
  return createHmac('sha256', sessionSecret).update(LABEL).update(password).digest('hex')
}

/**
 * Whether a stored fingerprint is a password session today: a password must be set, and the
 * fingerprint must be the current password's. Anything else (no password, an old cookie that
 * only says "signed in", a fingerprint of an earlier password) is not.
 */
export function isPasswordSession(stored: unknown, password: string | undefined, sessionSecret: string): boolean {
  if (!password || typeof stored !== 'string') return false
  const expected = Buffer.from(passwordFingerprint(password, sessionSecret))
  const actual = Buffer.from(stored)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

/** `off`: no password is set here, so there is nothing to compare with. */
export type PasswordResult = 'ok' | 'wrong' | 'locked' | 'off'

const MAX_FAILURES = 8
const WINDOW_MS = 10 * 60 * 1000

const digest = (value: string) => createHash('sha256').update(value).digest()

/**
 * Checks a candidate against the dashboard password in constant time, and slows down repeated
 * guessing per client address. Failed attempts are kept in memory, which is enough for a single
 * always-on process. With no password set it refuses before comparing anything.
 */
export function createPasswordChecker() {
  const failures = new Map<string, { count: number; resetAt: number }>()

  return function check(candidate: string, password: string | undefined, address: string, now: number = Date.now()): PasswordResult {
    if (!password) return 'off'

    const entry = failures.get(address)
    if (entry && entry.resetAt <= now) failures.delete(address)
    const current = failures.get(address)
    if (current && current.count >= MAX_FAILURES) return 'locked'

    if (timingSafeEqual(digest(candidate), digest(password))) {
      failures.delete(address)
      return 'ok'
    }
    failures.set(address, { count: (current?.count ?? 0) + 1, resetAt: current?.resetAt ?? now + WINDOW_MS })
    return 'wrong'
  }
}
