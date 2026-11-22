import { randomBytes } from 'node:crypto'
import { createServerFn } from '@tanstack/react-start'
import { TRPCClientError } from '@trpc/client'
import { api } from '@/server/api'
import { beginOAuth, youtubeRedirectUri } from '@/server/oauth'
import { requireSession } from './auth'

/** Whether the API has a Google OAuth client, and the redirect URI to register with it. */
export const youtubeSetupFn = createServerFn({ method: 'GET' })
  .middleware([requireSession])
  .handler(async () => {
    const { configured } = await api().youtube.setup.query()
    return { configured, redirectUri: youtubeRedirectUri() }
  })

/** Starts a Google sign-in for a YouTube channel and returns the URL the page then navigates to. */
export const startYouTubeConnectFn = createServerFn({ method: 'POST' })
  .middleware([requireSession])
  .handler(async () => {
    const state = randomBytes(24).toString('base64url')
    try {
      const { url } = await api().youtube.authorizeUrl.query({ redirectUri: youtubeRedirectUri(), state })
      await beginOAuth('youtube', state)
      return { ok: true as const, url }
    } catch (err) {
      const message =
        err instanceof TRPCClientError && err.data?.code === 'PRECONDITION_FAILED' ? err.message : 'Could not reach the API.'
      return { ok: false as const, message }
    }
  })
