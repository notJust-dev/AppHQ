import '@tanstack/react-start/server-only'
import { getCookie, setCookie } from '@tanstack/react-start/server'
import { getIronSession } from 'iron-session'
import { serverEnv } from './env'

interface SessionData {
  signedIn?: boolean
}

const THIRTY_DAYS = 60 * 60 * 24 * 30

/** The encrypted, http-only session cookie. v1 has one user, so it only records "signed in". */
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
