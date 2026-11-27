import { describe, expect, it } from 'vitest'
import { INTEGRATION_PAGES, connectedAddress, integrationPageFor } from './integration-pages'

describe('integrationPageFor', () => {
  it('sends every page that was under /accounts to its page under Settings', () => {
    for (const name of ['app-store', 'google-play', 'revenuecat', 'meta', 'tiktok', 'youtube', 'search-console']) {
      expect(integrationPageFor(name)).toBe(`/settings/integrations/${name}`)
    }
    expect(Object.keys(INTEGRATION_PAGES)).toHaveLength(7)
  })

  it('sends a name it never had to the list of integrations', () => {
    expect(integrationPageFor('instagram')).toBe('/settings/integrations')
    expect(integrationPageFor('constructor')).toBe('/settings/integrations')
  })
})

describe('connectedAddress', () => {
  it('is the integration page with the marker the page reads the outcome by', () => {
    expect(connectedAddress('tiktok')).toBe('/settings/integrations/tiktok?connected=tiktok')
    expect(connectedAddress('meta')).toBe('/settings/integrations/meta?connected=meta')
    expect(connectedAddress('youtube')).toBe('/settings/integrations/youtube?connected=youtube')
  })
})
