import { formatCount } from './format'
import type { AccountFamily, Asset } from './queries'

/**
 * What in Settings needs the person: sources an integration found that wait for a decision, and
 * integrations whose connection stopped working. The sidebar's Settings item, the Settings tabs
 * and the Overview banner all count from here (through `useAttention`), so they agree with each
 * other and with the pages.
 */

/** Found by an integration, in no app, and not ignored: the Apps page's "Needs a decision". */
export const waitingAssets = <T extends Pick<Asset, 'appId' | 'ignored'>>(assets: T[]): T[] =>
  assets.filter((asset) => asset.appId === null && !asset.ignored)

type Connection = Pick<AccountFamily['accounts'][number], 'provider' | 'status' | 'expiresAt'>

/**
 * Whether a connection stopped working: its key or sign-in was refused, or its last sync failed
 * (the API's status), or it is an Instagram sign-in past its end. Instagram cannot renew itself,
 * and the API only marks it once a sync has tried. Other expiry dates are of access tokens that
 * renew on their own.
 */
export function isBroken(connection: Connection, now = Date.now()): boolean {
  if (connection.status !== 'ok') return true
  return connection.provider === 'instagram' && connection.expiresAt !== null && Date.parse(connection.expiresAt) <= now
}

/**
 * The integrations with a connection that stopped working. Counted by integration, not by
 * connection: one Facebook sign-in brings many Pages, and is mended once.
 */
export const brokenIntegrations = (
  families: { family: AccountFamily['family']; accounts: Connection[] }[],
  now = Date.now(),
): AccountFamily['family'][] =>
  families.filter((family) => family.accounts.some((account) => isBroken(account, now))).map((family) => family.family)

const STORE_APPS = new Set(['ios_app', 'android_app'])

/** "3 new apps found": how many sources wait, named by what they are when they are all alike. */
export function foundLine(waiting: Pick<Asset, 'kind' | 'social'>[]): string {
  const count = waiting.length
  const [one, many] = waiting.every((asset) => STORE_APPS.has(asset.kind))
    ? ['app', 'apps']
    : waiting.every((asset) => asset.social)
      ? ['social account', 'social accounts']
      : ['source', 'sources']
  return `${formatCount(count)} new ${count === 1 ? one : many} found`
}
