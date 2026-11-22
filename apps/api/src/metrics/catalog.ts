/** Every value `metric_daily.source` can take. Connectors use these names; so do the queries. */
export const SOURCES = [
  'app_store',
  'google_play',
  'revenuecat',
  'tiktok',
  'instagram',
  'facebook',
  'search_console',
  'youtube',
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
  socialViews: { metric: 'views', sources: ['tiktok', 'instagram', 'facebook', 'youtube'] },
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
    sources: ['tiktok', 'instagram', 'facebook', 'youtube'],
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

export const SOCIAL_SOURCES = ['tiktok', 'instagram', 'facebook', 'youtube'] as const satisfies readonly Source[]
export const STORE_SOURCES = ['app_store', 'google_play'] as const satisfies readonly Source[]

/**
 * The series behind each performance page. Like the timeline rows, each is one metric summed
 * over the sources that report it; levels (followers, MRR, subscriptions) take the latest value
 * over a range instead of a total.
 */
export const PERFORMANCE = {
  social: [
    { key: 'views', label: 'Social views', metric: 'views', sources: SOCIAL_SOURCES, unit: 'count', aggregate: 'sum' },
    { key: 'followers', label: 'Followers', metric: 'followers', sources: SOCIAL_SOURCES, unit: 'count', aggregate: 'last' },
    { key: 'downloads', label: 'Downloads', metric: 'downloads', sources: STORE_SOURCES, unit: 'count', aggregate: 'sum' },
  ],
  store: [
    { key: 'impressions', label: 'Impressions', metric: 'impressions', sources: ['app_store'], unit: 'count', aggregate: 'sum' },
    { key: 'pageViews', label: 'Store page views', metric: 'page_views', sources: STORE_SOURCES, unit: 'count', aggregate: 'sum' },
    { key: 'downloads', label: 'Downloads', metric: 'downloads', sources: STORE_SOURCES, unit: 'count', aggregate: 'sum' },
  ],
  monetisation: [
    { key: 'revenue', label: 'Revenue', metric: 'revenue', sources: ['revenuecat'], unit: 'usd', aggregate: 'sum' },
    { key: 'mrr', label: 'MRR', metric: 'mrr', sources: ['revenuecat'], unit: 'usd', aggregate: 'last' },
    { key: 'activeSubs', label: 'Active subscriptions', metric: 'active_subs', sources: ['revenuecat'], unit: 'count', aggregate: 'last' },
    { key: 'activeTrials', label: 'Active trials', metric: 'active_trials', sources: ['revenuecat'], unit: 'count', aggregate: 'last' },
    { key: 'trials', label: 'Trials started', metric: 'trials', sources: ['revenuecat'], unit: 'count', aggregate: 'sum' },
    { key: 'newCustomers', label: 'New customers', metric: 'new_customers', sources: ['revenuecat'], unit: 'count', aggregate: 'sum' },
    { key: 'downloads', label: 'Downloads', metric: 'downloads', sources: STORE_SOURCES, unit: 'count', aggregate: 'sum' },
  ],
  search: [
    { key: 'clicks', label: 'Search clicks', metric: 'search_clicks', sources: ['search_console'], unit: 'count', aggregate: 'sum' },
    { key: 'impressions', label: 'Search impressions', metric: 'search_impressions', sources: ['search_console'], unit: 'count', aggregate: 'sum' },
    // Average position is this over impressions; stored as a sum so days and sites add up.
    { key: 'positionSum', label: 'Position × impressions', metric: 'search_position_sum', sources: ['search_console'], unit: 'count', aggregate: 'sum' },
  ],
} as const satisfies Record<
  string,
  readonly {
    key: string
    label: string
    metric: string
    sources: readonly Source[]
    unit: 'count' | 'usd'
    aggregate: 'sum' | 'last'
  }[]
>

export type PerformanceSection = keyof typeof PERFORMANCE
