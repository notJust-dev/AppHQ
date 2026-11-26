/**
 * Signing up and signing in with an email address and a password, from the browser. Each call
 * goes to this dashboard's own /api/auth, which forwards it to the API (routes/api/auth/$.ts);
 * the API decides everything, and these only turn its answers into words.
 */

/** Passwords: at least this long. Must match `MIN_PASSWORD_LENGTH` in apps/api/src/auth/email.ts. */
export const MIN_PASSWORD_LENGTH = 8
/** How long a sign-up code works, in minutes. Must match `CODE_MINUTES` there. */
export const CODE_MINUTES = 10
/** How long a reset link works, in minutes. Must match `RESET_MINUTES` there. */
export const RESET_MINUTES = 60
/** The API keeps a fresh code rather than send another; the page waits as long before offering one. */
export const NEW_CODE_AFTER_SECONDS = 60

export const PROBLEMS = {
  wrong: 'That email address or password is not correct.',
  code: 'That code is not right, or it has expired.',
  attempts: 'Too many wrong codes. Ask for a new one.',
  short: `Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`,
  long: 'Choose a shorter password.',
  address: 'Enter a valid email address.',
  limited: 'Too many attempts. Try again in a few minutes.',
  link: 'This link is no longer valid.',
  failed: 'Something went wrong. Try again.',
} as const

export type Problem = keyof typeof PROBLEMS
export type Outcome = { ok: true } | { ok: false; problem: Problem }

/** The API's error codes that get their own words; anything else is `failed`. */
const BY_CODE: Record<string, Problem> = {
  INVALID_EMAIL_OR_PASSWORD: 'wrong',
  INVALID_CODE: 'code',
  TOO_MANY_ATTEMPTS: 'attempts',
  PASSWORD_TOO_SHORT: 'short',
  PASSWORD_TOO_LONG: 'long',
  INVALID_EMAIL: 'address',
  INVALID_TOKEN: 'link',
}

async function post(path: string, body: Record<string, string>): Promise<Outcome> {
  try {
    const response = await fetch(`/api/auth/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (response.ok) return { ok: true }
    if (response.status === 429) return { ok: false, problem: 'limited' }
    const { code } = (await response.json().catch(() => ({}))) as { code?: unknown }
    return { ok: false, problem: (typeof code === 'string' ? BY_CODE[code] : undefined) ?? 'failed' }
  } catch {
    return { ok: false, problem: 'failed' }
  }
}

export const signInWithEmail = (email: string, password: string) => post('sign-in/email', { email, password })

/** Asks for a code. The answer is the same whether or not the address already has an account. */
export const sendSignUpCode = (email: string) => post('email-sign-up/send-code', { email })

/** Makes the account and signs it in, when the code is right. */
export const confirmSignUp = (email: string, code: string, password: string) =>
  post('email-sign-up/confirm', { email, code, password })

/** Asks for a reset link. The answer is the same whether or not the address has an account. */
export const requestPasswordReset = (email: string) => post('request-password-reset', { email })

export const resetPassword = (token: string, newPassword: string) => post('reset-password', { token, newPassword })
