import { describe, expect, it } from 'vitest'
import { brokenIntegrations, foundLine, isBroken, waitingAssets } from './attention'

const NOW = Date.parse('2026-03-10T12:00:00Z')
const connection = (provider: string, status = 'ok', expiresAt: string | null = null) => ({ provider, status, expiresAt })

describe('waitingAssets', () => {
  it('keeps what has no app and is not ignored', () => {
    const assets = [
      { id: 'linked', appId: 'app-1', ignored: false },
      { id: 'waiting', appId: null, ignored: false },
      { id: 'ignored', appId: null, ignored: true },
    ]
    expect(waitingAssets(assets).map((asset) => asset.id)).toEqual(['waiting'])
  })
})

describe('isBroken', () => {
  it('follows the status the API reports', () => {
    expect(isBroken(connection('tiktok'), NOW)).toBe(false)
    expect(isBroken(connection('tiktok', 'needs_reauth'), NOW)).toBe(true)
    expect(isBroken(connection('app_store', 'error'), NOW)).toBe(true)
  })

  it('counts an Instagram sign-in past its end before a sync has marked it', () => {
    expect(isBroken(connection('instagram', 'ok', '2026-03-09T00:00:00Z'), NOW)).toBe(true)
    expect(isBroken(connection('instagram', 'ok', '2026-03-20T00:00:00Z'), NOW)).toBe(false)
  })

  it('ignores the expiry of access tokens that renew themselves', () => {
    expect(isBroken(connection('tiktok', 'ok', '2026-03-09T00:00:00Z'), NOW)).toBe(false)
    expect(isBroken(connection('youtube', 'ok', '2026-03-09T00:00:00Z'), NOW)).toBe(false)
  })
})

describe('brokenIntegrations', () => {
  it('names each integration once, however many of its connections broke', () => {
    const families = [
      { family: 'meta' as const, accounts: [connection('facebook', 'needs_reauth'), connection('instagram', 'needs_reauth')] },
      { family: 'tiktok' as const, accounts: [connection('tiktok')] },
      { family: 'youtube' as const, accounts: [] },
      { family: 'app_store' as const, accounts: [connection('app_store', 'error')] },
    ]
    expect(brokenIntegrations(families, NOW)).toEqual(['meta', 'app_store'])
  })
})

describe('foundLine', () => {
  const asset = (kind: string, social = false) => ({ kind, social })

  it('calls store apps apps', () => {
    expect(foundLine([asset('ios_app'), asset('android_app'), asset('ios_app')])).toBe('3 new apps found')
    expect(foundLine([asset('ios_app')])).toBe('1 new app found')
  })

  it('calls social accounts social accounts', () => {
    expect(foundLine([asset('tiktok_account', true), asset('instagram_account', true)])).toBe('2 new social accounts found')
  })

  it('calls a mix sources', () => {
    expect(foundLine([asset('ios_app'), asset('revenuecat_project')])).toBe('2 new sources found')
    expect(foundLine([asset('search_console_site')])).toBe('1 new source found')
  })
})
