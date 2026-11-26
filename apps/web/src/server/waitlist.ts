import '@tanstack/react-start/server-only'
import { publicApi } from './api'
import { clientAddress } from './password'

const MAX_PER_WINDOW = 5
const WINDOW_MS = 60 * 60 * 1000

/** Sign-ups per client address. In memory is enough for a single always-on process. */
const attempts = new Map<string, { count: number; resetAt: number }>()

export type JoinResult = { result: 'ok'; answerToken: string | null } | { result: 'busy' }

/**
 * Puts an address on the waitlist through the API. The page is public, so one address can only
 * try a few times an hour; past that it is told to come back later.
 */
export async function joinWaitlist(email: string, now: number = Date.now()): Promise<JoinResult> {
  const address = clientAddress()
  const entry = attempts.get(address)
  if (entry && entry.resetAt <= now) attempts.delete(address)

  const current = attempts.get(address)
  if (current && current.count >= MAX_PER_WINDOW) return { result: 'busy' }
  attempts.set(address, { count: (current?.count ?? 0) + 1, resetAt: current?.resetAt ?? now + WINDOW_MS })

  const { answerToken } = await publicApi().waitlist.join.mutate({ email, source: 'landing' })
  return { result: 'ok', answerToken }
}
