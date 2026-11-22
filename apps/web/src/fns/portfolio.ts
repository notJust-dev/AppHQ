import { createServerFn } from '@tanstack/react-start'
import { TRPCClientError } from '@trpc/client'
import { z } from 'zod'
import { api } from '../server/api'
import { requireSession } from './auth'

export const getOverviewFn = createServerFn({ method: 'GET' })
  .middleware([requireSession])
  .validator(z.object({ from: z.iso.date(), to: z.iso.date() }))
  .handler(({ data }) => api().overview.get.query(data))

/** One app's social posts published in the range, newest first. */
export const listPostsFn = createServerFn({ method: 'GET' })
  .middleware([requireSession])
  .validator(z.object({ appId: z.string().min(1).max(64), from: z.iso.date(), to: z.iso.date() }))
  .handler(({ data }) => api().apps.posts.query({ ...data, limit: 100 }))

/** One app's daily funnel, or null when there is no such app. */
export const getAppTimelineFn = createServerFn({ method: 'GET' })
  .middleware([requireSession])
  .validator(z.object({ appId: z.string().min(1).max(64), from: z.iso.date(), to: z.iso.date() }))
  .handler(async ({ data }) => {
    try {
      return await api().apps.timeline.query(data)
    } catch (err) {
      if (err instanceof TRPCClientError && err.data?.code === 'NOT_FOUND') return null
      throw err
    }
  })
