import { createHmac, randomInt, timingSafeEqual } from 'node:crypto'
import type { BetterAuthPlugin } from 'better-auth'
import { APIError, createAuthEndpoint, formCsrfMiddleware } from 'better-auth/api'
import { setSessionCookie } from 'better-auth/cookies'
import { z } from 'zod'
import {
  existingAccountMessage,
  noPasswordMessage,
  passwordChangedMessage,
  providerList,
  resetPasswordMessage,
  signUpCodeMessage,
} from '../mail/messages.js'
import type { Outbox } from '../mail/outbox.js'

/**
 * Signing up with an email address and a password.
 *
 * 1. `/email-sign-up/send-code` mails a six-digit code to the address.
 * 2. `/email-sign-up/confirm` takes the address, the code and the password together, and only
 *    then makes the account, already confirmed, and signs it in.
 *
 * So an account never exists before its address is confirmed, and its password is always set by
 * someone who could read that address's mail. Until then the database holds neither the address
 * nor the code, only keyed hashes of them, which go when the code is used or has expired.
 *
 * Better Auth's own sign-up makes the account first and confirms it later; in between, whoever
 * typed the address has put a password on an account its real owner may then confirm. That
 * sign-up stays off (`disableSignUp`).
 *
 * Signing in (`/sign-in/email`) and resetting a password (`/request-password-reset`, then
 * `/reset-password`) are Better Auth's own endpoints; this plugin only supplies their emails.
 */

/** Passwords: at least this long. Must match `MIN_PASSWORD_LENGTH` in apps/web/src/lib/email-auth.ts. */
export const MIN_PASSWORD_LENGTH = 12
export const MAX_PASSWORD_LENGTH = 128

/** How long a sign-up code works, and how many wrong guesses it survives. */
export const CODE_MINUTES = 10
export const CODE_ATTEMPTS = 5
/** A new code replaces the one before it, so one address gets a new one at most this often. */
const NEW_CODE_AFTER_MS = 60_000

/** How long a reset link works. */
export const RESET_MINUTES = 60

/** Every endpoint of email sign-in, under /api/auth. Served only when email sign-in is on. */
export const EMAIL_PATHS = [
  '/sign-in/email',
  '/email-sign-up/send-code',
  '/email-sign-up/confirm',
  '/request-password-reset',
  '/reset-password',
] as const

const address = z.email().max(254)

/**
 * What a code is stored under: not the address. Nothing in the database names an address that
 * has not been confirmed, and nothing here can be turned back into one without the server's
 * secret.
 */
export function codeIdentifier(secret: string, email: string): string {
  return `sign-up-code:${createHmac('sha256', secret).update(`sign-up-address\n${email}`).digest('hex')}`
}

/** What is stored for a code: not the code, and useless without the server's secret. */
function seal(secret: string, email: string, code: string): string {
  return createHmac('sha256', secret).update(`sign-up-code\n${email}\n${code}`).digest('hex')
}

function sameSeal(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex')
  const right = Buffer.from(b, 'hex')
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right)
}

const newCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0')

const refuse = (code: 'INVALID_CODE' | 'TOO_MANY_ATTEMPTS' | 'PASSWORD_TOO_SHORT' | 'PASSWORD_TOO_LONG', message: string) =>
  new APIError('BAD_REQUEST', { code, message })

const hasPassword = (accounts: { providerId: string }[]) => accounts.some((account) => account.providerId === 'credential')
const providersOf = (accounts: { providerId: string }[]) => providerList(accounts.map((account) => account.providerId))

export function emailAccounts(deps: { outbox: Outbox; origin: string }): BetterAuthPlugin {
  const { outbox } = deps
  const loginUrl = `${deps.origin}/login`
  const forgotUrl = `${deps.origin}/forgot-password`

  return {
    id: 'email-accounts',

    // The reset emails need the account's sign-in methods, which only the context can look up.
    init(ctx) {
      return {
        options: {
          emailAndPassword: {
            enabled: true,
            async sendResetPassword({ user, token }) {
              const accounts = await ctx.internalAdapter.findAccounts(user.id)
              if (hasPassword(accounts)) {
                // The token is in the fragment, which browsers never send: it stays out of
                // every server's request log, and the page removes it from the address bar.
                const url = `${deps.origin}/reset-password#token=${encodeURIComponent(token)}`
                outbox.send('password reset link', { to: user.email, ...resetPasswordMessage({ url, minutes: RESET_MINUTES }) })
              } else {
                // An account made with Google or GitHub gets no password this way: a second way
                // in never joins an existing account. Its owner is told how they sign in.
                outbox.send('no password notice', { to: user.email, ...noPasswordMessage({ loginUrl, providers: providersOf(accounts) }) })
              }
            },
            async onPasswordReset({ user }) {
              outbox.send('password changed notice', { to: user.email, ...passwordChangedMessage({ forgotUrl }) })
            },
          },
        },
      }
    },

    endpoints: {
      /**
       * Mails a code to the address, or, when the address already has an account, a note that
       * says so. The answer and the work are the same either way, so they tell nobody who has an
       * account.
       */
      sendSignUpCode: createAuthEndpoint(
        '/email-sign-up/send-code',
        { method: 'POST', use: [formCsrfMiddleware], body: z.object({ email: address }) },
        async (ctx) => {
          const email = ctx.body.email.toLowerCase()
          const { internalAdapter } = ctx.context
          const done = () => ctx.json({ status: true })

          // The same reads and writes whether or not the address has an account, so the time a
          // request takes says nothing either. Only the email differs.
          const identifier = codeIdentifier(ctx.context.secret, email)
          const existing = await internalAdapter.findUserByEmail(email, { includeAccounts: true })
          const current = await internalAdapter.findVerificationValue(identifier)

          // A new code replaces the last one. So that nobody can keep cancelling the code of
          // someone who is signing up, a fresh code stays, and so does the current one once the
          // address has had its share of mail.
          const now = Date.now()
          const fresh = current && current.expiresAt.getTime() > now && now - new Date(current.createdAt).getTime() < NEW_CODE_AFTER_MS
          if (fresh || !outbox.hasRoom(email)) return done()

          const code = newCode()
          await internalAdapter.deleteVerificationByIdentifier(identifier)
          await internalAdapter.createVerificationValue({
            identifier,
            value: `${seal(ctx.context.secret, email, code)}:0`,
            expiresAt: new Date(now + CODE_MINUTES * 60_000),
          })

          if (existing) {
            // The code made above is never sent, and `confirm` refuses an address that has an
            // account whatever the code. The owner is told that they already have one.
            outbox.send('existing account notice', {
              to: existing.user.email,
              ...existingAccountMessage({
                loginUrl,
                forgotUrl,
                hasPassword: hasPassword(existing.accounts),
                providers: providersOf(existing.accounts),
              }),
            })
          } else {
            outbox.send('sign-up code', { to: email, ...signUpCodeMessage({ code, minutes: CODE_MINUTES }) })
          }
          return done()
        },
      ),

      /** Makes the account and signs it in, when the code is the one mailed to the address. */
      confirmSignUp: createAuthEndpoint(
        '/email-sign-up/confirm',
        {
          method: 'POST',
          use: [formCsrfMiddleware],
          body: z.object({ email: address, code: z.string().max(20), password: z.string().max(1000) }),
        },
        async (ctx) => {
          const email = ctx.body.email.toLowerCase()
          const { password } = ctx.body
          const code = ctx.body.code.replace(/\s/g, '')
          const { internalAdapter } = ctx.context
          const wrong = () => refuse('INVALID_CODE', 'That code is not right, or it has expired.')

          // Before the code is looked at, so a password that is too short does not cost a guess.
          if (password.length < MIN_PASSWORD_LENGTH) throw refuse('PASSWORD_TOO_SHORT', `Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`)
          if (password.length > MAX_PASSWORD_LENGTH) throw refuse('PASSWORD_TOO_LONG', `Choose a password of at most ${MAX_PASSWORD_LENGTH} characters.`)
          if (!/^\d{6}$/.test(code)) throw wrong()

          // Taking the code out is one step in the database: of several guesses sent at once,
          // one gets it and the others find nothing, so the count of guesses can't be outrun.
          const identifier = codeIdentifier(ctx.context.secret, email)
          const taken = await internalAdapter.consumeVerificationValue(identifier)
          if (!taken) throw wrong()
          const separator = taken.value.lastIndexOf(':')
          const sealed = taken.value.slice(0, separator)
          const guesses = Number(taken.value.slice(separator + 1)) || 0

          if (!sameSeal(sealed, seal(ctx.context.secret, email, code))) {
            // The last allowed guess spends the code; before that it goes back, one guess down.
            if (guesses + 1 >= CODE_ATTEMPTS) throw refuse('TOO_MANY_ATTEMPTS', 'Too many wrong codes. Ask for a new one.')
            await internalAdapter.createVerificationValue({
              identifier,
              value: `${sealed}:${guesses + 1}`,
              expiresAt: taken.expiresAt,
              createdAt: taken.createdAt,
            })
            throw wrong()
          }

          // The address may have got an account since the code was sent, with Google or GitHub.
          if (await internalAdapter.findUserByEmail(email)) throw wrong()

          const hash = await ctx.context.password.hash(password)
          const user = await internalAdapter.createUser({ email, name: '', emailVerified: true }, { method: 'email-password' })
          try {
            await internalAdapter.linkAccount({ userId: user.id, providerId: 'credential', accountId: user.id, password: hash })
          } catch (err) {
            // Without its password the account could never be used, and would block the address.
            await internalAdapter.deleteUser(user.id).catch(() => {})
            throw err
          }

          const session = await internalAdapter.createSession(user.id)
          await setSessionCookie(ctx, { session, user })
          return ctx.json({ status: true })
        },
      ),
    },
  }
}
