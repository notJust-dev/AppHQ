/** Without these the Meta connectors cannot read Pages, Page insights or Instagram. */
export const META_ESSENTIAL = [
  'pages_show_list',
  'pages_read_engagement',
  'read_insights',
  'instagram_basic',
  'instagram_manage_insights',
]

/** Warn this long before the Facebook sign-in, and with it Instagram, stops working. */
const RENEW_WARNING_MS = 10 * 86_400_000

/**
 * What needs the person about a Meta sign-in: the permissions it lacks, and when it must be
 * renewed (Instagram stops after about 60 days with the Facebook login setup).
 */
export function metaHealth(
  accounts: { provider: string; expiresAt: string | null; scopes: string[] | null }[],
  now = Date.now(),
) {
  const renewBy = accounts
    .filter((account) => account.provider === 'instagram' && account.expiresAt)
    .map((account) => account.expiresAt ?? '')
    .sort()[0]
  const renewSoon = renewBy !== undefined && Date.parse(renewBy) - now < RENEW_WARNING_MS
  // What the latest sign-in was granted, as Meta reported it; unknown for older connections.
  const granted = accounts.find((account) => account.scopes !== null)?.scopes ?? null
  const missing = granted ? META_ESSENTIAL.filter((scope) => !granted.includes(scope)) : []
  return { renewBy, renewSoon, missing }
}
