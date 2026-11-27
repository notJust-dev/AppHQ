import { createServerFn } from '@tanstack/react-start'
import { TRPCClientError } from '@trpc/client'
import { z } from 'zod'
import { requireDashboardAccess } from './auth'

export const getOverviewFn = createServerFn({ method: 'GET' })
  .middleware([requireDashboardAccess])
  .validator(z.object({ from: z.iso.date(), to: z.iso.date() }))
  .handler(({ data, context }) => context.api.overview.get.query(data))

/** The most posts a page lists, the newest of the range; as many as the API gives. */
export const POSTS_LIMIT = 200

/** Social posts published in the range, newest first: one app's, or every app's. */
export const listPostsFn = createServerFn({ method: 'GET' })
  .middleware([requireDashboardAccess])
  .validator(z.object({ appId: z.string().min(1).max(64).optional(), from: z.iso.date(), to: z.iso.date() }))
  .handler(({ data, context }) => context.api.apps.posts.query({ ...data, limit: POSTS_LIMIT }))

/** One app's totals for the funnel and flow charts, or null when there is no such app. */
export const getAppFlowFn = createServerFn({ method: 'GET' })
  .middleware([requireDashboardAccess])
  .validator(z.object({ appId: z.string().min(1).max(64), from: z.iso.date(), to: z.iso.date() }))
  .handler(async ({ data, context }) => {
    try {
      return await context.api.apps.flow.query(data)
    } catch (err) {
      if (err instanceof TRPCClientError && err.data?.code === 'NOT_FOUND') return null
      throw err
    }
  })

/** One app's daily funnel, or null when there is no such app. */
export const getAppTimelineFn = createServerFn({ method: 'GET' })
  .middleware([requireDashboardAccess])
  .validator(z.object({ appId: z.string().min(1).max(64), from: z.iso.date(), to: z.iso.date() }))
  .handler(async ({ data, context }) => {
    try {
      return await context.api.apps.timeline.query(data)
    } catch (err) {
      if (err instanceof TRPCClientError && err.data?.code === 'NOT_FOUND') return null
      throw err
    }
  })
