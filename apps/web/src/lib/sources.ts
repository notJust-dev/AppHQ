const LABELS: Record<string, string> = {
  revenuecat: 'RevenueCat',
  app_store: 'App Store',
  google_play: 'Google Play',
  tiktok: 'TikTok',
  instagram: 'Instagram',
  facebook: 'Facebook',
  heartbeat: 'Cron check',
}

/** The name people know a data source by; the raw id if it is one this build has not met. */
export const sourceLabel = (source: string) => LABELS[source] ?? source
