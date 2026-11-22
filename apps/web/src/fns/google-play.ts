import { createServerFn } from '@tanstack/react-start'
import { TRPCClientError } from '@trpc/client'
import { z } from 'zod'
import { api } from '../server/api'
import { requireSession } from './auth'

/** The API's own message for a problem with what was entered; a generic line otherwise. */
function messageFrom(err: unknown, fallback: string): string {
  if (err instanceof TRPCClientError) {
    const code: unknown = err.data?.code
    if (code === 'BAD_REQUEST' || code === 'PRECONDITION_FAILED') return err.message
  }
  return fallback
}

export const playPackagesFn = createServerFn({ method: 'GET' })
  .middleware([requireSession])
  .handler(() => api().googlePlay.packages.query())

export const connectGooglePlayFn = createServerFn({ method: 'POST' })
  .middleware([requireSession])
  .validator(
    z.object({
      serviceAccountJson: z.string().trim().min(100).max(10_000),
      storageUri: z.string().trim().min(3).max(500),
    }),
  )
  .handler(async ({ data }) => {
    try {
      return { ok: true as const, ...(await api().googlePlay.connect.mutate(data)) }
    } catch (err) {
      return { ok: false as const, message: messageFrom(err, 'Could not reach the API.') }
    }
  })

/** Gives a package to an app, to a new app ('new'), or to none (null). */
export const assignPlayPackageFn = createServerFn({ method: 'POST' })
  .middleware([requireSession])
  .validator(z.object({ packageName: z.string().min(1).max(200), appId: z.string().min(1).max(64).nullable() }))
  .handler(async ({ data }) => {
    try {
      await api().googlePlay.assign.mutate(data)
      return { ok: true as const }
    } catch (err) {
      return { ok: false as const, message: messageFrom(err, 'Could not save that. Try again.') }
    }
  })
