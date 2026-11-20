import { createServerFn } from '@tanstack/react-start'
import { TRPCClientError } from '@trpc/client'
import { z } from 'zod'
import { api } from '../server/api'
import { requireSession } from './auth'

/**
 * The API writes its 4xx messages for the person using the dashboard, so those are passed on.
 * Anything else (the API being down, a bug) gets a generic line instead of internals.
 */
function messageFrom(err: unknown, fallback: string): string {
  if (err instanceof TRPCClientError) {
    const code: unknown = err.data?.code
    if (code === 'BAD_REQUEST' || code === 'PRECONDITION_FAILED') return err.message
  }
  return fallback
}

export const listAppsFn = createServerFn({ method: 'GET' })
  .middleware([requireSession])
  .handler(() => api().apps.list.query())

export const getSyncStatusFn = createServerFn({ method: 'GET' })
  .middleware([requireSession])
  .handler(() => api().sync.status.query())

export const connectRevenueCatFn = createServerFn({ method: 'POST' })
  .middleware([requireSession])
  .validator(z.object({ apiKey: z.string().trim().min(8).max(500) }))
  .handler(async ({ data }) => {
    try {
      const { apps } = await api().apps.connectRevenueCat.mutate(data)
      return { ok: true as const, apps }
    } catch (err) {
      return { ok: false as const, message: messageFrom(err, 'Could not reach the API.') }
    }
  })

export const runSyncFn = createServerFn({ method: 'POST' })
  .middleware([requireSession])
  .handler(() => api().sync.run.mutate({}))

export const loadDemoDataFn = createServerFn({ method: 'POST' })
  .middleware([requireSession])
  .handler(() => api().demo.seed.mutate({}))

export const removeDemoDataFn = createServerFn({ method: 'POST' })
  .middleware([requireSession])
  .handler(() => api().demo.clear.mutate())
