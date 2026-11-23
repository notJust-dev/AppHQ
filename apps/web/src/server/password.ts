import '@tanstack/react-start/server-only'
import { createHash, timingSafeEqual } from 'node:crypto'
import { getRequestHeader } from '@tanstack/react-start/server'
import { serverEnv } from './env'

const MAX_FAILURES = 8
const WINDOW_MS = 10 * 60 * 1000

/** Failed attempts per client address. In memory is enough for a single always-on process. */
const failures = new Map<string, { count: number; resetAt: number }>()

const digest = (value: string) => createHash('sha256').update(value).digest()

export function clientAddress(): string {
  // Velocity sits behind Cloudflare, which sets cf-connecting-ip.
  return (
    getRequestHeader('cf-connecting-ip') ??
    getRequestHeader('x-forwarded-for')?.split(',')[0]?.trim() ??
    'local'
  )
}

export type PasswordResult = 'ok' | 'wrong' | 'locked'

/** Checks the dashboard password in constant time and slows down repeated guessing. */
export function checkPassword(candidate: string, now: number = Date.now()): PasswordResult {
  const address = clientAddress()
  const entry = failures.get(address)
  if (entry && entry.resetAt <= now) failures.delete(address)

  const current = failures.get(address)
  if (current && current.count >= MAX_FAILURES) return 'locked'

  if (timingSafeEqual(digest(candidate), digest(serverEnv().DASHBOARD_PASSWORD))) {
    failures.delete(address)
    return 'ok'
  }

  failures.set(address, {
    count: (current?.count ?? 0) + 1,
    resetAt: current?.resetAt ?? now + WINDOW_MS,
  })
  return 'wrong'
}
