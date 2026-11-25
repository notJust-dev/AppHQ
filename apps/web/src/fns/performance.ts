import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireDashboardAccess } from './auth'

const input = z.object({ from: z.iso.date(), to: z.iso.date(), appId: z.string().min(1).max(64).optional() })

/** Social views, followers and posts, with downloads to set them against. */
export const getSocialPerformanceFn = createServerFn({ method: 'GET' })
  .middleware([requireDashboardAccess])
  .validator(input)
  .handler(({ data, context }) => context.api.performance.social.query(data))

/** The store funnel: impressions, page views and downloads, by store. */
export const getStorePerformanceFn = createServerFn({ method: 'GET' })
  .middleware([requireDashboardAccess])
  .validator(input)
  .handler(({ data, context }) => context.api.performance.store.query(data))

/** Revenue, MRR, subscriptions and trials, with downloads for revenue per download. */
export const getMonetisationPerformanceFn = createServerFn({ method: 'GET' })
  .middleware([requireDashboardAccess])
  .validator(input)
  .handler(({ data, context }) => context.api.performance.monetisation.query(data))
