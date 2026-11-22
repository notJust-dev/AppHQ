import { createFileRoute } from '@tanstack/react-router'
import { api } from '@/server/api'
import { finishOAuth, youtubeRedirectUri } from '@/server/oauth'
import { callbackError, providerErrorMessage, redirectTo } from '@/server/oauth-callback'
import { getAppSession } from '@/server/session'

/**
 * Where Google sends the browser after the YouTube sign-in. Same checks as Meta's: the session,
 * the state from the same browser within its window, and the provider's own error first.
 */
export const Route = createFileRoute('/connect/youtube/callback')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = await getAppSession()
        if (!session.signedIn) return redirectTo('/login')

        const params = new URL(request.url).searchParams
        const attempt = await finishOAuth('youtube', params.get('state'))
        const finish = async (ok: boolean, message: string) => {
          await attempt.report(ok, message)
          return redirectTo('/accounts/youtube?connected=youtube')
        }

        const error = params.get('error')
        if (error) return finish(false, providerErrorMessage('Google', error))

        const code = params.get('code')
        if (!code || !attempt.matches) {
          return finish(false, 'This sign-in expired or was started in another browser. Start it again here.')
        }

        try {
          const result = await api().youtube.connect.mutate({ code, redirectUri: youtubeRedirectUri() })
          return finish(
            true,
            `Found ${result.channel}. Link it to the app it promotes on the Apps page or in the app's Settings; ` +
              'its history is fetched as soon as it has one.',
          )
        } catch (err) {
          return finish(false, callbackError(err))
        }
      },
    },
  },
})
