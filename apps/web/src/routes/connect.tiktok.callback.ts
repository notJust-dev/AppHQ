import { createFileRoute } from '@tanstack/react-router'
import { api } from '../server/api'
import { finishOAuth, tiktokRedirectUri } from '../server/oauth'
import { getAppSession } from '../server/session'
import { callbackError, providerErrorMessage, redirectTo } from '../server/oauth-callback'

/**
 * Where TikTok sends the browser after sign-in. It checks the session and the state from the
 * OAuth cookie, has the API trade the code for tokens, and goes back to Accounts with the
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
        const attempt = await finishOAuth('tiktok', params.get('state'))
        const finish = async (ok: boolean, message: string) => {
          await attempt.report(ok, message)
          return redirectTo('/accounts/tiktok?connected=tiktok')
        }

        const error = params.get('error')
        if (error) return finish(false, providerErrorMessage('TikTok', error))

        const code = params.get('code')
        if (!code || !attempt.matches || !attempt.appId) {
          return finish(false, 'This sign-in expired or was started in another browser. Start it again here.')
        }

        try {
          const result = await api().tiktok.connect.mutate({
            code,
            redirectUri: tiktokRedirectUri(),
            appId: attempt.appId,
          })
          return finish(
            true,
            `Connected ${result.account} to ${result.appName}. Its videos are being read now and ` +
              "show on the app's page within a minute. Daily views start tomorrow: TikTok only " +
              'reports totals, so a day is the difference between two readings.',
          )
        } catch (err) {
          return finish(false, callbackError(err))
        }
      },
    },
  },
})
