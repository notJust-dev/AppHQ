import { createFileRoute } from '@tanstack/react-router'
import { api } from '../server/api'
import { finishOAuth, metaRedirectUri } from '../server/oauth'
import { callbackError, providerErrorMessage, redirectTo } from '../server/oauth-callback'
import { getAppSession } from '../server/session'

/**
 * Where Facebook sends the browser after sign-in. Same checks as TikTok's; the difference is
 * that no app was chosen beforehand, since one sign-in can bring Pages for several apps.
 */
export const Route = createFileRoute('/connect/meta/callback')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = await getAppSession()
        if (!session.signedIn) return redirectTo('/login')

        const params = new URL(request.url).searchParams
        const attempt = await finishOAuth('meta', params.get('state'))
        const finish = async (ok: boolean, message: string) => {
          await attempt.report(ok, message)
          return redirectTo('/settings?connected=meta')
        }

        const error = params.get('error')
        if (error) return finish(false, providerErrorMessage('Facebook', error))

        const code = params.get('code')
        if (!code || !attempt.matches) {
          return finish(false, 'This sign-in expired or was started in another browser. Start it again here.')
        }

        try {
          const result = await api().meta.connect.mutate({ code, redirectUri: metaRedirectUri() })
          const found =
            `${result.pages} ${result.pages === 1 ? 'Page' : 'Pages'} and ${result.instagram} ` +
            `Instagram ${result.instagram === 1 ? 'account' : 'accounts'}`
          const missing =
            result.missing.length > 0
              ? ` Meta did not grant ${result.missing.join(', ')}, so some numbers will not come ` +
                'through: add them to the login configuration in the Meta app, then connect again.'
              : ''
          return finish(
            true,
            `Found ${found}. Choose the app each one promotes below; its history is fetched as ` +
              `soon as it has one.${missing}`,
          )
        } catch (err) {
          return finish(false, callbackError(err))
        }
      },
    },
  },
})
