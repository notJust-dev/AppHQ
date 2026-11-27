/**
 * The addresses of the integrations' pages that other places need to know: the pages that
 * sign-ins come back to, and where addresses from before Settings (`/accounts/...`) lead now.
 */

/** Each integration's page, by the last part of its address (the same as under `/accounts/`). */
export const INTEGRATION_PAGES = {
  'app-store': '/settings/integrations/app-store',
  'google-play': '/settings/integrations/google-play',
  revenuecat: '/settings/integrations/revenuecat',
  meta: '/settings/integrations/meta',
  tiktok: '/settings/integrations/tiktok',
  youtube: '/settings/integrations/youtube',
  'search-console': '/settings/integrations/search-console',
} as const

type IntegrationPage = (typeof INTEGRATION_PAGES)[keyof typeof INTEGRATION_PAGES]

/**
 * The page a provider's sign-in comes back to, with `?connected=<provider>` for it to read the
 * outcome. The callback addresses registered with the providers (`/connect/<provider>/callback`)
 * stay as they are; only where they send the browser next lives here.
 */
export const CONNECTED_PAGES = {
  tiktok: INTEGRATION_PAGES.tiktok,
  meta: INTEGRATION_PAGES.meta,
  youtube: INTEGRATION_PAGES.youtube,
} as const

/** Where a provider's callback sends the browser once the sign-in is done or has failed. */
export const connectedAddress = (provider: keyof typeof CONNECTED_PAGES) => `${CONNECTED_PAGES[provider]}?connected=${provider}`

/** Where `/accounts/<name>` leads now: that integration's page, or the list for a name it never had. */
export function integrationPageFor(name: string): IntegrationPage | '/settings/integrations' {
  return Object.hasOwn(INTEGRATION_PAGES, name)
    ? INTEGRATION_PAGES[name as keyof typeof INTEGRATION_PAGES]
    : '/settings/integrations'
}
