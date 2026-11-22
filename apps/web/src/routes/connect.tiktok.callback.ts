import { createFileRoute } from '@tanstack/react-router'
import { TRPCClientError } from '@trpc/client'
import { api } from '../server/api'
import { OAUTH_WINDOW_MS, getOAuthSession, tiktokRedirectUri } from '../server/oauth'
import { getAppSession } from '../server/session'

const redirectTo = (path: string) => new Response(null, { status: 302, headers: { location: path } })

/**
 * Where TikTok sends the browser after sign-in. It checks the session and the state from the
 * OAuth cookie, has the API trade the code for tokens, and goes back to Settings with the
 * outcome stored in the cookie. Nothing from the query string is shown as text, so a crafted
 * link cannot put words on the page.
 */
export const Route = createFileRoute('/connect/tiktok/callback')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = await getAppSession()
        if (!session.signedIn) return redirectTo('/login')

        const params = new URL(request.url).searchParams
        const oauth = await getOAuthSession()
        const { state, appId, startedAt } = oauth

        const finish = async (ok: boolean, message: string) => {
          oauth.state = undefined
          oauth.appId = undefined
          oauth.startedAt = undefined
          oauth.result = { ok, message }
          await oauth.save()
          return redirectTo('/settings?connected=tiktok')
        }

        const error = params.get('error')
        if (error) {
          const code = /^[a-z_]{1,40}$/.test(error) ? error : 'unknown'
          return finish(
            false,
            code === 'access_denied'
              ? 'The TikTok sign-in was cancelled, so nothing was connected.'
              : `TikTok could not complete the sign-in (${code}). Try again.`,
          )
        }

        const code = params.get('code')
        const returnedState = params.get('state')
        const fresh = startedAt !== undefined && Date.now() - startedAt < OAUTH_WINDOW_MS
        if (!code || !returnedState || !state || !appId || returnedState !== state || !fresh) {
          return finish(
            false,
            'This sign-in expired or was started in another browser. Start it again here.',
          )
        }

        try {
          const result = await api().tiktok.connect.mutate({
            code,
            redirectUri: tiktokRedirectUri(),
            appId,
          })
          return finish(
            true,
            `Connected ${result.account} to ${result.appName}. Its videos are being read now and ` +
              "show on the app's page within a minute. Daily views start tomorrow: TikTok only " +
              'reports totals, so a day is the difference between two readings.',
          )
        } catch (err) {
          const code: unknown = err instanceof TRPCClientError ? err.data?.code : undefined
          const passOn = code === 'BAD_REQUEST' || code === 'PRECONDITION_FAILED'
          return finish(
            false,
            passOn && err instanceof Error ? err.message : 'Could not reach the API. Try again.',
          )
        }
      },
    },
  },
})
