import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { apps, assets, connections, type App, type Asset, type Connection } from '../db/schema.js'
import { uniqueSlug } from '../lib/slug.js'
import { ConnectInputError } from '../services/errors.js'
import { ASSET_KINDS, PORTFOLIO_APP_ID, type AssetKind } from './kinds.js'

const CHUNK = 500

export interface AssetInput {
  kind: AssetKind
  externalId: string
  name: string
  connectionId: string | null
  details?: Record<string, unknown> | null
}

type Details = Record<string, unknown>
const detailsOf = (asset: Pick<Asset, 'details'>): Details =>
  asset.details && typeof asset.details === 'object' ? (asset.details as Details) : {}
const detail = (asset: Pick<Asset, 'details'>, key: string): string | null => {
  const value = detailsOf(asset)[key]
  return typeof value === 'string' && value !== '' ? value : null
}

/**
 * Saves what an account found. A known asset gets its name, account and details refreshed;
 * which app it belongs to, and whether it is ignored, stay as they are.
 */
export async function upsertAssets(db: Db, inputs: AssetInput[]): Promise<Asset[]> {
  const saved: Asset[] = []
  for (let i = 0; i < inputs.length; i += CHUNK) {
    const rows = await db
      .insert(assets)
      .values(inputs.slice(i, i + CHUNK).map((input) => ({ ...input, details: input.details ?? null })))
      .onConflictDoUpdate({
        target: [assets.kind, assets.externalId],
        set: {
          name: sql`excluded.name`,
          connectionId: sql`excluded.connection_id`,
          details: sql`coalesce(excluded.details, ${assets.details})`,
          updatedAt: sql`now()`,
        },
      })
      .returning()
    saved.push(...rows)
  }
  return saved
}

/** The assets of a kind that belong to an app (any app when `appId` is left out), with their account. */
export async function linkedAssets(
  db: Db,
  kind: AssetKind,
  appId?: string,
): Promise<{ asset: Asset; connection: Connection | null }[]> {
  const rows = await db
    .select({ asset: assets, connection: connections })
    .from(assets)
    .leftJoin(connections, eq(connections.id, assets.connectionId))
    .where(and(eq(assets.kind, kind), appId === undefined ? isNotNull(assets.appId) : eq(assets.appId, appId)))
  return rows
}

/** Makes an app and returns its id. */
export async function createApp(db: Db, name: string): Promise<string> {
  const trimmed = name.trim()
  if (!trimmed) throw new ConnectInputError('Give the app a name.')
  const known = await db.select({ id: apps.id }).from(apps)
  const id = uniqueSlug(trimmed, new Set(known.map((app) => app.id)))
  await db.insert(apps).values({ id, name: trimmed })
  return id
}

/**
 * Gives an asset to an app, to a new app made for it (`'new'`), to the portfolio, or to none
 * (`null`). An app holds one iOS app, one Android app and one RevenueCat project, so giving it
 * another of those takes the old one off. Linking can make other links obvious (an Instagram
 * account whose Page just got its app), so those follow.
 */
export async function assignAsset(
  db: Db,
  input: { assetId: string; appId: string | null },
): Promise<{ asset: Asset; appId: string | null }> {
  const [asset] = await db.select().from(assets).where(eq(assets.id, input.assetId)).limit(1)
  if (!asset) throw new ConnectInputError('That account or app is no longer connected. Reload the page.')
  const kind = ASSET_KINDS[asset.kind as AssetKind]
  if (!kind) throw new ConnectInputError('Unknown kind of asset.')

  let appId = input.appId
  if (appId === 'new') {
    if (kind.social) throw new ConnectInputError('Pick the app this account promotes, or the portfolio.')
    appId = await createApp(db, detail(asset, 'title') ?? asset.name)
  } else if (appId === PORTFOLIO_APP_ID) {
    if (!kind.social) throw new ConnectInputError(`A ${kind.label} belongs to one app, not to the portfolio.`)
  } else if (appId !== null) {
    const [app] = await db.select({ id: apps.id }).from(apps).where(eq(apps.id, appId)).limit(1)
    if (!app) throw new ConnectInputError('That app no longer exists. Reload the page.')
  }

  await db.transaction(async (tx) => {
    if (appId !== null && kind.slot === 'one') {
      await tx
        .update(assets)
        .set({ appId: null, updatedAt: new Date() })
        .where(and(eq(assets.kind, asset.kind), eq(assets.appId, appId)))
    }
    await tx
      .update(assets)
      .set({ appId, ignored: false, decided: true, updatedAt: new Date() })
      .where(eq(assets.id, asset.id))
  })
  if (appId !== null) await autoLink(db)
  return { asset, appId }
}

/** Marks an asset as not needing a decision, or brings it back. Ignoring also unlinks it. */
export async function setIgnored(db: Db, assetId: string, ignored: boolean) {
  const updated = await db
    .update(assets)
    .set({ ignored, decided: true, ...(ignored ? { appId: null } : {}), updatedAt: new Date() })
    .where(eq(assets.id, assetId))
    .returning({ id: assets.id })
  if (updated.length === 0) throw new ConnectInputError('That asset is no longer there. Reload the page.')
}

/**
 * Links what exact evidence settles, and nothing else:
 * - an Android package equal to an app's iOS bundle id;
 * - a store app named in an app's RevenueCat project, and the other way round;
 * - an Instagram account linked to a Page that already has its app.
 * Only unlinked, not ignored assets move, and only into a free slot; an asset a person has
 * placed, or taken off an app, stays where they left it.
 */
export async function autoLink(db: Db): Promise<number> {
  let linked = 0
  for (let pass = 0; pass < 3; pass++) {
    const all = await db.select().from(assets)
    const linkedOf = (kind: AssetKind) => all.filter((a) => a.kind === kind && a.appId !== null)
    const hasSlot = (appId: string, kind: AssetKind) => all.some((a) => a.kind === kind && a.appId === appId)
    const moves: { asset: Asset; appId: string }[] = []

    for (const asset of all) {
      if (asset.appId !== null || asset.ignored || asset.decided) continue
      const candidates: (string | null)[] = []
      if (asset.kind === 'android_app') {
        candidates.push(
          linkedOf('ios_app').find((ios) => detail(ios, 'bundleId') === asset.externalId)?.appId ?? null,
          linkedOf('revenuecat_project').find((rc) => detail(rc, 'androidPackage') === asset.externalId)?.appId ?? null,
        )
      } else if (asset.kind === 'ios_app') {
        const bundleId = detail(asset, 'bundleId')
        if (bundleId) {
          candidates.push(
            linkedOf('revenuecat_project').find((rc) => detail(rc, 'bundleId') === bundleId)?.appId ?? null,
            linkedOf('android_app').find((android) => android.externalId === bundleId)?.appId ?? null,
          )
        }
      } else if (asset.kind === 'revenuecat_project') {
        const bundleId = detail(asset, 'bundleId')
        const androidPackage = detail(asset, 'androidPackage')
        candidates.push(
          bundleId ? (linkedOf('ios_app').find((ios) => detail(ios, 'bundleId') === bundleId)?.appId ?? null) : null,
          androidPackage
            ? (linkedOf('android_app').find((android) => android.externalId === androidPackage)?.appId ?? null)
            : null,
        )
      } else if (asset.kind === 'instagram_account') {
        const pageId = detail(asset, 'pageId')
        if (pageId) candidates.push(linkedOf('facebook_page').find((page) => page.externalId === pageId)?.appId ?? null)
      }

      const appId = candidates.find((candidate): candidate is string => candidate !== null)
      if (!appId) continue
      const kind = ASSET_KINDS[asset.kind as AssetKind]
      if (kind?.slot === 'one' && (hasSlot(appId, asset.kind as AssetKind) || moves.some((m) => m.appId === appId && m.asset.kind === asset.kind))) {
        continue
      }
      moves.push({ asset, appId })
    }

    if (moves.length === 0) break
    for (const move of moves) {
      await db.update(assets).set({ appId: move.appId, updatedAt: new Date() }).where(eq(assets.id, move.asset.id))
    }
    linked += moves.length
  }
  return linked
}

const STOP_WORDS = new Set(['app', 'the', 'for', 'and', 'with', 'your', 'official', 'page'])
const tokens = (text: string) =>
  text
    .toLowerCase()
    .replace(/^@/, '')
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token))
const squashed = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * The app an unlinked asset most likely belongs to, judged by name, or null. A suggestion only:
 * "TinyKicks Baby Kick Tracker" → TinyKicks, "@getzenfit" → "Chair Yoga For Seniors: ZenFit".
 */
export function suggestApp(asset: Pick<Asset, 'name' | 'details'>, candidates: Pick<App, 'id' | 'name'>[]): string | null {
  const assetName = detail(asset as Asset, 'title') ?? asset.name
  const assetTokens = tokens(assetName)
  const assetSquashed = squashed(assetName)
  let best: { id: string; score: number } | null = null

  for (const app of candidates) {
    const appTokens = tokens(app.name)
    const appSquashed = squashed(app.name)
    if (appTokens.length === 0) continue
    let score = 0
    // The whole app name inside the asset name, or the other way round.
    if (appSquashed.length >= 4 && (assetSquashed.includes(appSquashed) || appSquashed.includes(assetSquashed))) score = 1
    // Shared words; a handle counts a word it contains ("getzenfit" has "zenfit").
    const shared = appTokens.filter(
      (token) => assetTokens.includes(token) || (token.length >= 4 && assetSquashed.includes(token)),
    ).length
    score = Math.max(score, shared / Math.min(appTokens.length, Math.max(assetTokens.length, 1)))
    if (score >= 0.5 && (!best || score > best.score)) best = { id: app.id, score }
  }
  return best?.id ?? null
}

/** Unlinks and removes demo assets: they have no account behind them. */
export async function deleteAssetsOf(db: Db, appIds: string[]) {
  if (appIds.length === 0) return
  await db.delete(assets).where(and(inArray(assets.appId, appIds), sql`${assets.connectionId} is null`))
}
