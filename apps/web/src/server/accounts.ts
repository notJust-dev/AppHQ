import '@tanstack/react-start/server-only'
import { isIP } from 'node:net'
import { getRequestHeader, getRequestIP } from '@tanstack/react-start/server'
import { clientAddress } from './password'

/**
 * Where the visitor's address goes on requests to the API's /api/auth, for its rate limits. This
 * server always sets it, replacing anything the visitor sent. Must match `CLIENT_ADDRESS_HEADER`
 * in apps/api/src/auth/auth.ts.
 */
export const CLIENT_ADDRESS_HEADER = 'x-apphq-client-address'

/** Better Auth's cookie names, with or without the `__Secure-` prefix it uses over https. */
const AUTH_COOKIE = /^(__Secure-)?better-auth\.[\w.-]+=/

/**
 * The visitor's Better Auth cookies, and no other: the dashboard password's session cookie never
 * leaves this server.
 */
export function authCookies(header: string | undefined = getRequestHeader('cookie')): string | undefined {
  const kept = (header ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => AUTH_COOKIE.test(part))
  return kept.length > 0 ? kept.join('; ') : undefined
}

/** Whether the visitor has a session cookie from an account sign-in; not whether it is valid. */
export function hasAccountCookie(): boolean {
  return /(^|;\s*)(__Secure-)?better-auth\.session_token=/.test(getRequestHeader('cookie') ?? '')
}

/** The visitor's address when it is one; otherwise nothing, and the API counts them together. */
export function visitorAddress(): string | undefined {
  for (const candidate of [clientAddress(), getRequestIP()]) {
    if (candidate && isIP(candidate)) return candidate
  }
  return undefined
}
