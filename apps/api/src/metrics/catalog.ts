/** Every value `metric_daily.source` can take. Connectors use these names; so do the queries. */
export const SOURCES = [
  'app_store',
  'google_play',
  'revenuecat',
  'tiktok',
  'instagram',
  'facebook',
] as const

export type Source = (typeof SOURCES)[number]

/**
 * The three numbers the overview leads with, defined once: each is one metric summed over the
 * sources that report it. Revenue comes from RevenueCat only, so there is one currency (USD)
 * and one definition of revenue.
 */
export const HEADLINE = {
  downloads: { metric: 'downloads', sources: ['app_store', 'google_play'] },
  revenue: { metric: 'revenue', sources: ['revenuecat'] },
  socialViews: { metric: 'views', sources: ['tiktok', 'instagram', 'facebook'] },
} as const satisfies Record<string, { metric: string; sources: readonly Source[] }>

export type HeadlineKey = keyof typeof HEADLINE
