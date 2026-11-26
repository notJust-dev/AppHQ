/**
 * What a connected account can give access to. An app holds at most one of each `one` kind and
 * any number of the `many` kinds; social accounts may also belong to the portfolio as a whole.
 */
export const ASSET_KINDS = {
  ios_app: { label: 'iOS app', provider: 'app_store', slot: 'one', social: false, backfillDays: 364 },
  android_app: { label: 'Android app', provider: 'google_play', slot: 'one', social: false, backfillDays: 365 },
  revenuecat_project: { label: 'RevenueCat project', provider: 'revenuecat', slot: 'one', social: false, backfillDays: 400 },
  facebook_page: { label: 'Facebook Page', provider: 'facebook', slot: 'many', social: true, backfillDays: 365 },
  instagram_account: { label: 'Instagram account', provider: 'instagram', slot: 'many', social: true, backfillDays: 90 },
  tiktok_account: { label: 'TikTok account', provider: 'tiktok', slot: 'many', social: true, backfillDays: 7 },
  youtube_channel: { label: 'YouTube channel', provider: 'youtube', slot: 'many', social: true, backfillDays: 365 },
  search_console_site: { label: 'Website', provider: 'search_console', slot: 'one', social: false, backfillDays: 480 },
} as const

export type AssetKind = keyof typeof ASSET_KINDS
export const ASSET_KIND_NAMES = Object.keys(ASSET_KINDS) as AssetKind[]

export const isAssetKind = (value: string): value is AssetKind => value in ASSET_KINDS

/**
 * Said instead of an app id to give an asset to the organization's portfolio: its one app of kind
 * 'portfolio', which holds accounts that promote several apps.
 */
export const PORTFOLIO = 'portfolio'
