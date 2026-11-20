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

/**
 * The rows of an app's funnel timeline, in funnel order. Each is one metric summed over the
 * sources that report it. `stage` groups them for colour: attention, acquisition, money.
 * `aggregate` says how a range is summed up: a total for flows, the latest value for levels
 * such as MRR, where adding days together means nothing.
 */
export const TIMELINE = [
  {
    key: 'socialViews',
    label: 'Social views',
    metric: 'views',
    sources: ['tiktok', 'instagram', 'facebook'],
    stage: 'views',
    unit: 'count',
    aggregate: 'sum',
  },
  {
    key: 'pageViews',
    label: 'Store page views',
    metric: 'page_views',
    sources: ['app_store', 'google_play'],
    stage: 'views',
    unit: 'count',
    aggregate: 'sum',
  },
  {
    key: 'downloads',
    label: 'Downloads',
    metric: 'downloads',
    sources: ['app_store', 'google_play'],
    stage: 'downloads',
    unit: 'count',
    aggregate: 'sum',
  },
  {
    key: 'trials',
    label: 'Trials started',
    metric: 'trials',
    sources: ['revenuecat'],
    stage: 'revenue',
    unit: 'count',
    aggregate: 'sum',
  },
  {
    key: 'revenue',
    label: 'Revenue',
    metric: 'revenue',
    sources: ['revenuecat'],
    stage: 'revenue',
    unit: 'usd',
    aggregate: 'sum',
  },
  {
    key: 'mrr',
    label: 'MRR',
    metric: 'mrr',
    sources: ['revenuecat'],
    stage: 'revenue',
    unit: 'usd',
    aggregate: 'last',
  },
] as const satisfies readonly {
  key: string
  label: string
  metric: string
  sources: readonly Source[]
  stage: 'views' | 'downloads' | 'revenue'
  unit: 'count' | 'usd'
  aggregate: 'sum' | 'last'
}[]
