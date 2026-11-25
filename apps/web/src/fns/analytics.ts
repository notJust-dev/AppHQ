import { createServerFn } from '@tanstack/react-start'
import { analyticsConfig } from '@/server/analytics'

/** Public: the PostHog project key is meant to be seen by browsers. Null when analytics are off. */
export const getAnalyticsConfigFn = createServerFn({ method: 'GET' }).handler(async () => analyticsConfig())
