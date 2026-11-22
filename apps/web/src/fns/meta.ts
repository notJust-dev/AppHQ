import { randomBytes } from 'node:crypto'
import { createServerFn } from '@tanstack/react-start'
import { TRPCClientError } from '@trpc/client'
import { api } from '@/server/api'
import { beginOAuth, metaRedirectUri } from '@/server/oauth'
import { requireSession } from './auth'

/** Whether the API has Meta credentials, and the redirect URI to register with Meta. */
export const metaSetupFn = createServerFn({ method: 'GET' })
  .middleware([requireSession])
  .handler(async () => {
    const { configured } = await api().meta.setup.query()
    return { configured, redirectUri: metaRedirectUri() }
  })

/** Starts a Facebook sign-in and returns the URL the page then navigates to. */
export const startMetaConnectFn = createServerFn({ method: 'POST' })
  .middleware([requireSession])
  .handler(async () => {
    const state = randomBytes(24).toString('base64url')
    try {
      const { url } = await api().meta.authorizeUrl.query({ redirectUri: metaRedirectUri(), state })
      await beginOAuth('meta', state)
      return { ok: true as const, url }
    } catch (err) {
      const message =
        err instanceof TRPCClientError && err.data?.code === 'PRECONDITION_FAILED'
          ? err.message
          : 'Could not reach the API.'
      return { ok: false as const, message }
    }
  })
