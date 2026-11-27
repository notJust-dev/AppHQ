import '@tanstack/react-start/server-only'
import { getCookie, getRequestUrl, setCookie } from '@tanstack/react-start/server'
import { getIronSession } from 'iron-session'
import { serverEnv } from './env'

export type OAuthProvider = 'tiktok' | 'meta' | 'youtube'

interface OAuthData {
  /** Which sign-in this is, so one provider's callback cannot finish another's. */
  provider?: OAuthProvider
  /** The one-time value sent to the provider and checked when it sends the browser back. */
  state?: string
  /** The app the account will be connected to. */
  appId?: string
  /** The organization the sign-in started in, as the API gave it; the API checks it at the end. */
  organizationId?: string
  startedAt?: number
  /** Shown once on the integration's page after the redirect back, then cleared. */
  result?: { ok: boolean; message: string; provider?: OAuthProvider }
}

/** A sign-in has this long to come back before its state is refused. */
export const OAUTH_WINDOW_MS = 15 * 60_000

/**
 * A short-lived encrypted cookie for one sign-in attempt, separate from the session cookie.
 * SameSite=Lax is what lets it come back on the provider's redirect, which is a top-level GET.
 */
export function getOAuthSession() {
  return getIronSession<OAuthData>(
    { read: getCookie, write: setCookie },
    {
      cookieName: 'appdashboard-oauth',
      password: serverEnv().SESSION_SECRET,
      ttl: OAUTH_WINDOW_MS / 1000,
      cookieOptions: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: process.env.NODE_ENV === 'production',
      },
    },
  )
}

/**
 * This dashboard's public address. PUBLIC_URL wins when set; otherwise it comes from the
 * request, using the proxy's forwarded host and protocol, as Velocity's Nginx sends them.
 */
export function publicOrigin(): string {
  const configured = process.env.PUBLIC_URL?.trim()
  if (configured) return new URL(configured).origin
  return getRequestUrl({ xForwardedHost: true, xForwardedProto: true }).origin
}

/** Must match, character for character, a redirect URI registered in the TikTok app. */
export const tiktokRedirectUri = () => `${publicOrigin()}/connect/tiktok/callback`

/** Must match a Valid OAuth Redirect URI of the Meta app's Facebook Login for Business. */
export const metaRedirectUri = () => `${publicOrigin()}/connect/meta/callback`

/** Must match an Authorized redirect URI of the Google OAuth client. */
export const youtubeRedirectUri = () => `${publicOrigin()}/connect/youtube/callback`

/** Remembers a sign-in that is about to leave for the provider. */
export async function beginOAuth(provider: OAuthProvider, state: string, organizationId: string, appId?: string) {
  const oauth = await getOAuthSession()
  oauth.provider = provider
  oauth.state = state
  oauth.appId = appId
  oauth.organizationId = organizationId
  oauth.startedAt = Date.now()
  oauth.result = undefined
  await oauth.save()
}

/**
 * Checks a provider's redirect against the sign-in that started it, then forgets the attempt.
 * Returns the app and organization of the start when it matches, or null when it does not (expired, from
 * another browser, or another provider's).
 */
export async function finishOAuth(provider: OAuthProvider, returnedState: string | null) {
  const oauth = await getOAuthSession()
  const { state, appId, organizationId, startedAt } = oauth
  const fresh = startedAt !== undefined && Date.now() - startedAt < OAUTH_WINDOW_MS
  const matches = oauth.provider === provider && !!state && returnedState === state && fresh && !!organizationId
  oauth.provider = undefined
  oauth.state = undefined
  oauth.appId = undefined
  oauth.organizationId = undefined
  oauth.startedAt = undefined
  return {
    matches,
    appId: appId ?? null,
    organizationId: organizationId ?? '',
    /** Stores the message the integration's page shows once, and saves the cookie. */
    async report(ok: boolean, message: string) {
      oauth.result = { ok, message, provider }
      await oauth.save()
    },
  }
}
