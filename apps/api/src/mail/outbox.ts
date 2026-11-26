import type { Logger } from '../lib/logger.js'
import type { Mailer, MailMessage } from './mailer.js'

/** What a message is, for the log. The log never holds an address or a message's text. */
export type MailKind = 'sign-up code' | 'existing account notice' | 'password reset link' | 'no password notice' | 'password changed notice'

export interface Outbox {
  /**
   * Hands a message to the mail server in the background, unless its address has had too many
   * lately. Returns whether it was accepted. It never throws and never waits for the mail
   * server, so a request takes the same time whether or not it led to a message.
   */
  send(kind: MailKind, message: MailMessage): boolean
  /** Whether a message to this address would be accepted now. */
  hasRoom(to: string): boolean
}

export interface OutboxLimits {
  /** Messages one address may be sent per window. */
  max: number
  windowMs: number
}

/** Five an hour: enough to sign up, mistype and reset, too few to flood anyone's inbox. */
export const DEFAULT_LIMITS: OutboxLimits = { max: 5, windowMs: 60 * 60_000 }

/** How many addresses are remembered before the ones with nothing recent are forgotten. */
const PRUNE_ABOVE = 5_000

/**
 * Sends account mail, and holds each address to a few messages an hour. The sign-up and reset
 * forms are public, so without this anyone could use them to fill a stranger's inbox, whatever
 * address they call from. The count is kept in memory: a restart forgets it, like the sign-in
 * rate limits.
 */
export function createOutbox(
  mailer: Mailer,
  log: Logger,
  limits: OutboxLimits = DEFAULT_LIMITS,
  now: () => number = Date.now,
): Outbox {
  const sentAt = new Map<string, number[]>()

  const recent = (to: string): number[] => {
    const key = to.trim().toLowerCase()
    const cutoff = now() - limits.windowMs
    const times = (sentAt.get(key) ?? []).filter((time) => time > cutoff)
    if (times.length > 0) sentAt.set(key, times)
    else sentAt.delete(key)
    return times
  }

  const prune = () => {
    if (sentAt.size <= PRUNE_ABOVE) return
    for (const key of [...sentAt.keys()]) recent(key)
  }

  return {
    hasRoom: (to) => recent(to).length < limits.max,

    send(kind, message) {
      const times = recent(message.to)
      if (times.length >= limits.max) {
        log.warn(`mail: not sending a ${kind}: that address has had ${limits.max} messages in the last ${Math.round(limits.windowMs / 60_000)} minutes`)
        return false
      }
      sentAt.set(message.to.trim().toLowerCase(), [...times, now()])
      prune()
      void Promise.resolve()
        .then(() => mailer.send(message))
        .catch((err: unknown) => log.error(`mail: could not send a ${kind}: ${reason(err)}`))
      return true
    },
  }
}

/** Why sending failed, without the mail server's own text: that can repeat the address. */
function reason(err: unknown): string {
  const { code, responseCode } = (err ?? {}) as { code?: unknown; responseCode?: unknown }
  const parts = [typeof code === 'string' ? code : null, typeof responseCode === 'number' ? `SMTP ${responseCode}` : null].filter(Boolean)
  return parts.length > 0 ? parts.join(', ') : 'the mail server could not be reached or refused the message'
}
