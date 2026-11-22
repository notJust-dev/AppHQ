import { randomBytes } from 'node:crypto'
import { createServerFn } from '@tanstack/react-start'
import { TRPCClientError } from '@trpc/client'
import { z } from 'zod'
import { api } from '../server/api'
import { getOAuthSession, tiktokRedirectUri } from '../server/oauth'
import { requireSession } from './auth'

/** Whether the API has TikTok credentials, and the redirect URI to register with TikTok. */
export const tiktokSetupFn = createServerFn({ method: 'GET' })
  .middleware([requireSession])
  .handler(async () => {
    const { configured } = await api().tiktok.setup.query()
    return { configured, redirectUri: tiktokRedirectUri() }
  })

/**
 * Starts a TikTok sign-in for one app: remembers a fresh state in the OAuth cookie and returns
 * TikTok's sign-in URL, which the page then navigates to.
 */
export const startTikTokConnectFn = createServerFn({ method: 'POST' })
  .middleware([requireSession])
  .validator(z.object({ appId: z.string().min(1).max(64) }))
  .handler(async ({ data }) => {
    const state = randomBytes(24).toString('base64url')
    try {
      const { url } = await api().tiktok.authorizeUrl.query({
        redirectUri: tiktokRedirectUri(),
        state,
      })
      const oauth = await getOAuthSession()
      oauth.state = state
      oauth.appId = data.appId
      oauth.startedAt = Date.now()
      oauth.result = undefined
      await oauth.save()
      return { ok: true as const, url }
    } catch (err) {
      const message =
        err instanceof TRPCClientError && err.data?.code === 'PRECONDITION_FAILED'
          ? err.message
          : 'Could not reach the API.'
      return { ok: false as const, message }
    }
  })

/** The outcome of the last sign-in, once: reading it clears it. */
export const takeConnectResultFn = createServerFn({ method: 'POST' })
  .middleware([requireSession])
  .handler(async () => {
    const oauth = await getOAuthSession()
    const result = oauth.result ?? null
    if (result) oauth.destroy()
    return result
  })
