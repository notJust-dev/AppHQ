import { Link } from '@tanstack/react-router'
import { useId, useState } from 'react'
import {
  ATTENTION,
  KIND_LABEL,
  ONE_SLOT_KINDS,
  PLATFORM_OF_KIND,
  SOURCE_OF_KIND,
  assetDetail,
} from '../lib/assets'
import type { AppSummary, Asset } from '../lib/queries'
import { Button } from './Button'
import { useAssetActions, type AssetActions } from './useAssetActions'

/**
 * What feeds one app: its iOS app, Android app and RevenueCat project, one of each, and any
 * number of social accounts. Shared accounts hold social accounts only.
 */
export function AppSources(props: { app: AppSummary; apps: AppSummary[]; assets: Asset[] }) {
  const { app, apps, assets } = props
  const actions = useAssetActions()
  const appName = (appId: string) =>
    apps.find((other) => other.id === appId)?.name ?? 'another app'
  const mine = assets.filter((asset) => asset.appId === app.id)
  const portfolio = app.kind === 'portfolio'

  return (
    <section id="sources" className="mt-12 scroll-mt-6" aria-labelledby="sources-heading">
      <h2 id="sources-heading" className="font-display text-xl font-semibold tracking-tight">
        Sources
      </h2>
      <p className="mt-1 max-w-prose text-sm text-ink-soft">
        {portfolio
          ? 'Social accounts that promote several apps. Their views count toward the portfolio, not toward one app.'
          : 'What feeds this app. Linking one fetches its history, so the charts fill in a few minutes later.'}
      </p>
      {actions.notice && (
        <p role="status" className={`mt-4 text-sm ${actions.notice.ok ? 'text-ink-soft' : 'font-medium'}`}>
          {actions.notice.message}
        </p>
      )}
      <ul className="mt-4 max-w-3xl divide-y divide-line rounded-lg border border-line bg-surface text-sm">
        {!portfolio &&
          ONE_SLOT_KINDS.map((kind) => (
            <SlotRow
              key={kind}
              kind={kind}
              appId={app.id}
              current={mine.find((asset) => asset.kind === kind)}
              candidates={assets.filter((asset) => asset.kind === kind && !asset.ignored)}
              appName={appName}
              actions={actions}
            />
          ))}
        <SocialRow
          appId={app.id}
          linked={mine.filter((asset) => asset.social)}
          candidates={assets.filter((asset) => asset.social && !asset.ignored && asset.appId !== app.id)}
          appName={appName}
          actions={actions}
        />
      </ul>
    </section>
  )
}

/** Where an asset belongs now, said next to it in a list of choices. */
function whereNow(asset: Asset, appName: (appId: string) => string) {
  if (asset.appId === null) return ''
  return asset.appId === 'portfolio' ? ' (in Shared accounts)' : ` (now in ${appName(asset.appId)})`
}

function SlotRow(props: {
  kind: string
  appId: string
  current: Asset | undefined
  candidates: Asset[]
  appName: (appId: string) => string
  actions: AssetActions
}) {
  const { kind, appId, current, candidates, appName, actions } = props
  const selectId = useId()
  const label = KIND_LABEL[kind] ?? kind

  return (
    <li className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-6 py-4">
      <label htmlFor={selectId} className="w-full font-medium sm:w-40 sm:shrink-0">
        {label}
      </label>
      {candidates.length === 0 ? (
        <span className="w-full min-w-0 text-ink-soft sm:w-auto sm:flex-1">
          None found.{' '}
          <Link to="/accounts" className="font-medium text-ink underline underline-offset-4">
            Connect {SOURCE_OF_KIND[kind]}
          </Link>{' '}
          to find one.
        </span>
      ) : (
        <span className="w-full min-w-0 sm:w-auto sm:flex-1">
          <select
            id={selectId}
            value={current?.id ?? ''}
            disabled={actions.pending}
            onChange={(event) => {
              const chosen = event.target.value
              if (chosen === '') {
                if (current) actions.assign(current.id, null)
              } else {
                actions.assign(chosen, appId)
              }
            }}
            className="w-full max-w-md rounded-md border border-line bg-surface px-3 py-2"
          >
            <option value="">None</option>
            {candidates.map((asset) => {
              const detail = assetDetail(asset)
              return (
                <option key={asset.id} value={asset.id}>
                  {asset.name}
                  {detail ? ` · ${detail}` : ''}
                  {asset.appId === appId ? '' : whereNow(asset, appName)}
                </option>
              )
            })}
          </select>
          {current && ATTENTION[current.status] && (
            <span className="mt-1 block text-xs font-medium">
              The account behind it {ATTENTION[current.status]}.{' '}
              <Link to="/accounts" className="underline underline-offset-4">
                Accounts
              </Link>
            </span>
          )}
        </span>
      )}
    </li>
  )
}

function SocialRow(props: {
  appId: string
  linked: Asset[]
  candidates: Asset[]
  appName: (appId: string) => string
  actions: AssetActions
}) {
  const { appId, linked, candidates, appName, actions } = props
  const [adding, setAdding] = useState('')
  const selectId = useId()

  return (
    <li className="flex flex-wrap gap-x-6 gap-y-3 px-6 py-4">
      <span className="w-full font-medium sm:w-40 sm:shrink-0">Social accounts</span>
      <div className="w-full min-w-0 space-y-3 sm:w-auto sm:flex-1">
        {linked.length > 0 ? (
          <ul className="space-y-2">
            {linked.map((asset) => (
              <li key={asset.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                <span className="min-w-0 break-words">
                  <span className="text-ink-soft">{PLATFORM_OF_KIND[asset.kind]}</span> {asset.name}
                  {ATTENTION[asset.status] && (
                    <span className="block text-xs font-medium">The account {ATTENTION[asset.status]}.</span>
                  )}
                </span>
                <Button
                  className="px-3 py-1"
                  disabled={actions.pending}
                  onClick={() => actions.assign(asset.id, null)}
                  aria-label={`Remove ${asset.name}`}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-ink-soft">None yet.</p>
        )}
        {candidates.length > 0 ? (
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              if (!adding) return
              actions.assign(adding, appId)
              setAdding('')
            }}
          >
            <label htmlFor={selectId} className="sr-only">
              Social account to add
            </label>
            <select
              id={selectId}
              value={adding}
              onChange={(event) => setAdding(event.target.value)}
              className="min-w-0 flex-1 rounded-md border border-line bg-surface px-3 py-2"
            >
              <option value="" disabled>
                Add a social account
              </option>
              {candidates.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {PLATFORM_OF_KIND[asset.kind]} {asset.name}
                  {whereNow(asset, appName)}
                </option>
              ))}
            </select>
            <Button type="submit" disabled={!adding || actions.pending}>
              Add
            </Button>
          </form>
        ) : (
          <p className="text-xs text-ink-soft">
            To add more,{' '}
            <Link to="/accounts" className="font-medium text-ink underline underline-offset-4">
              connect Facebook, Instagram or TikTok
            </Link>
            .
          </p>
        )}
      </div>
    </li>
  )
}
