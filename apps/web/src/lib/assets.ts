/** How the dashboard names and groups assets: what feeds an app. Mirrors the API's kinds. */

export const KIND_LABEL: Record<string, string> = {
  ios_app: 'iOS app',
  android_app: 'Android app',
  revenuecat_project: 'RevenueCat project',
  facebook_page: 'Facebook Page',
  instagram_account: 'Instagram account',
  tiktok_account: 'TikTok account',
  youtube_channel: 'YouTube channel',
  search_console_site: 'Website',
}

/** An app holds at most one of each of these. */
export const ONE_SLOT_KINDS = ['ios_app', 'android_app', 'revenuecat_project', 'search_console_site'] as const
/** And any number of these; they may also belong to the portfolio. */
export const SOCIAL_KINDS = ['facebook_page', 'instagram_account', 'tiktok_account', 'youtube_channel'] as const

/** Where to go to get an asset of a kind. */
export const SOURCE_OF_KIND: Record<string, string> = {
  ios_app: 'App Store Connect',
  android_app: 'Google Play',
  revenuecat_project: 'RevenueCat',
  facebook_page: 'Facebook and Instagram',
  instagram_account: 'Facebook and Instagram',
  tiktok_account: 'TikTok',
  youtube_channel: 'YouTube',
  search_console_site: 'Google Search Console',
}

/** Sent instead of an app id to give an asset to the portfolio, the row that holds accounts shared by several apps. */
export const PORTFOLIO_APP_ID = 'portfolio'

export const isSocial = (kind: string) => (SOCIAL_KINDS as readonly string[]).includes(kind)

/** The source whose logo an asset of a kind wears, such as a social account's platform (see `SourceLogo`). */
export const LOGO_OF_KIND: Record<string, string> = {
  ios_app: 'app_store',
  android_app: 'google_play',
  revenuecat_project: 'revenuecat',
  facebook_page: 'facebook',
  instagram_account: 'instagram',
  tiktok_account: 'tiktok',
  youtube_channel: 'youtube',
  search_console_site: 'search_console',
}

/** The account states that need the person to do something, in their words. */
export const ATTENTION: Record<string, string> = {
  needs_reauth: 'needs connecting again',
  error: 'last sync failed',
}

/** The identifier that tells two assets of a kind apart, when the name alone may not. */
export function assetDetail(asset: { kind: string; name: string; externalId: string; bundleId: string | null }) {
  switch (asset.kind) {
    case 'ios_app':
      return asset.bundleId ?? `Apple ID ${asset.externalId}`
    case 'android_app':
      return asset.externalId === asset.name ? null : asset.externalId
    case 'revenuecat_project':
      return asset.bundleId ?? asset.externalId
    default:
      return null
  }
}
