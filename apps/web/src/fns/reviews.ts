import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { api } from '@/server/api'
import { requireSession } from './auth'

const filters = {
  appId: z.string().min(1).max(64).optional(),
  store: z.enum(['app_store', 'google_play']).optional(),
  rating: z.number().int().min(1).max(5).optional(),
  unread: z.boolean().optional(),
}

/** One page of reviews, newest first. */
export const listReviewsFn = createServerFn({ method: 'GET' })
  .middleware([requireSession])
  .validator(z.object({ ...filters, before: z.object({ createdAt: z.string(), id: z.string() }).optional() }))
  .handler(({ data }) => api().reviews.list.query({ ...data, limit: 30 }))

export const reviewSummaryFn = createServerFn({ method: 'GET' })
  .middleware([requireSession])
  .validator(z.object({ appId: filters.appId, store: filters.store }))
  .handler(({ data }) => api().reviews.summary.query(data))

export const unreadReviewsFn = createServerFn({ method: 'GET' })
  .middleware([requireSession])
  .handler(() => api().reviews.unreadCount.query())

/** Marks reviews read or unread: by id, or every one matching the filters. */
export const markReviewsFn = createServerFn({ method: 'POST' })
  .middleware([requireSession])
  .validator(
    z.object({
      ids: z.array(z.string()).min(1).max(500).optional(),
      filters: z.object(filters).optional(),
      read: z.boolean(),
    }),
  )
  .handler(({ data }) => api().reviews.mark.mutate(data))
