import '@tanstack/react-start/server-only'
import { getCookie, setCookie } from '@tanstack/react-start/server'
import { getIronSession } from 'iron-session'
import { serverEnv } from './env'

interface SessionData {
  /**
   * Set by signing in with the dashboard password: a fingerprint of that password (see
   * password-session.ts), which stops counting once the password changes or is unset. Cookies
   * from before it existed only say `signedIn`, which no longer counts for anything.
   */
  password?: string
}

const THIRTY_DAYS = 60 * 60 * 24 * 30

/**
 * The encrypted, http-only session cookie of the dashboard password. Accounts have their own
 * cookie, Better Auth's, which this server forwards to the API.
 */
export function getAppSession() {
  return getIronSession<SessionData>(
    { read: getCookie, write: setCookie },
    {
      cookieName: 'appdashboard-session',
      password: serverEnv().SESSION_SECRET,
      ttl: THIRTY_DAYS,
      cookieOptions: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: process.env.NODE_ENV === 'production',
      },
    },
  )
}
