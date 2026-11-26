import { createServerFn } from '@tanstack/react-start'
import { TRPCClientError } from '@trpc/client'
import { z } from 'zod'
import { requireDashboardAccess } from './auth'

/** The API's own message for a problem with what was entered; a generic line otherwise. */
function messageFrom(err: unknown, fallback: string): string {
  if (err instanceof TRPCClientError) {
    const code: unknown = err.data?.code
    if (code === 'BAD_REQUEST' || code === 'PRECONDITION_FAILED') return err.message
  }
  return fallback
}

export const connectGooglePlayFn = createServerFn({ method: 'POST' })
  .middleware([requireDashboardAccess])
  .validator(
    z.object({
      serviceAccountJson: z.string().trim().min(100).max(10_000),
      storageUri: z.string().trim().min(3).max(500),
    }),
  )
  .handler(async ({ data, context }) => {
    try {
      return { ok: true as const, ...(await context.api.googlePlay.connect.mutate(data)) }
    } catch (err) {
      return { ok: false as const, message: messageFrom(err, 'Could not reach the API.') }
    }
  })
