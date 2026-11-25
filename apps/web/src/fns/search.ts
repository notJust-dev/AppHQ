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

/** Connects Search Console with a pasted key, or the key Google Play already uses. */
export const connectSearchConsoleFn = createServerFn({ method: 'POST' })
  .middleware([requireDashboardAccess])
  .validator(z.object({ serviceAccountJson: z.string().max(10_000).optional(), usePlayKey: z.boolean().optional() }))
  .handler(async ({ data, context }) => {
    try {
      return { ok: true as const, ...(await context.api.searchConsole.connect.mutate(data)) }
    } catch (err) {
      return { ok: false as const, message: messageFrom(err, 'Could not reach the API.') }
    }
  })

/** Clicks, impressions and position over a range, for all apps or one. */
export const getSearchPerformanceFn = createServerFn({ method: 'GET' })
  .middleware([requireDashboardAccess])
  .validator(z.object({ from: z.iso.date(), to: z.iso.date(), appId: z.string().min(1).max(64).optional() }))
  .handler(({ data, context }) => context.api.performance.search.query(data))

/** The top queries or pages over a range, read live from Search Console. */
export const searchTopFn = createServerFn({ method: 'GET' })
  .middleware([requireDashboardAccess])
  .validator(
    z.object({
      from: z.iso.date(),
      to: z.iso.date(),
      appId: z.string().min(1).max(64).optional(),
      dimension: z.enum(['query', 'page']),
    }),
  )
  .handler(async ({ data, context }) => {
    try {
      return { ok: true as const, ...(await context.api.searchConsole.top.query({ ...data, limit: 20 })) }
    } catch (err) {
      return { ok: false as const, message: messageFrom(err, 'Could not read Search Console.'), connected: true, rows: [] }
    }
  })
