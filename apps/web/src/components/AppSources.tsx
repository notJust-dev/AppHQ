import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { useId, useState } from 'react'
import { connectRevenueCatFn } from '../fns/settings'
import {
  ATTENTION,
  KIND_LABEL,
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
          STORE_KINDS.map((kind) => (
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
        {!portfolio && (
          <RevenueCatRow
            app={app}
            current={mine.find((asset) => asset.kind === 'revenuecat_project')}
            others={assets.filter(
              (asset) => asset.kind === 'revenuecat_project' && !asset.ignored && asset.appId !== app.id,
            )}
            appName={appName}
            actions={actions}
          />
        )}
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

/** Store apps come from an account connected once, on the Accounts page. */
const STORE_KINDS = ['ios_app', 'android_app'] as const

/** The page where the account behind each store kind is set up. */
const SETUP_PAGE = {
  ios_app: '/accounts/app-store',
  android_app: '/accounts/google-play',
} as const

/** Where an asset belongs now, said next to it in a list of choices. */
function whereNow(asset: Asset, appName: (appId: string) => string) {
  if (asset.appId === null) return ''
  return asset.appId === 'portfolio' ? ' (in Shared accounts)' : ` (now in ${appName(asset.appId)})`
}

function SlotRow(props: {
  kind: (typeof STORE_KINDS)[number]
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
          <Link to={SETUP_PAGE[kind]} className="font-medium text-ink underline underline-offset-4">
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
              <Link to={SETUP_PAGE[kind]} className="underline underline-offset-4">
                Connect it again
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

/**
 * A RevenueCat key belongs to one project, so it is connected here, from the app it feeds,
 * rather than on the Accounts page.
 */
function RevenueCatRow(props: {
  app: AppSummary
  current: Asset | undefined
  others: Asset[]
  appName: (appId: string) => string
  actions: AssetActions
}) {
  const { app, current, others, appName, actions } = props
  const [replacing, setReplacing] = useState(false)
  const [choice, setChoice] = useState('')
  // Said after a key connects, outside the form, which closes once the project shows here.
  const [connected, setConnected] = useState<string | null>(null)
  const selectId = useId()

  return (
    <li className="flex flex-wrap gap-x-6 gap-y-3 px-6 py-4">
      <span className="w-full font-medium sm:w-40 sm:shrink-0">RevenueCat project</span>
      <div className="w-full min-w-0 space-y-3 sm:w-auto sm:flex-1">
        {current && (
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <span className="min-w-0 break-words">
              {current.name}
              <span className="block text-xs text-ink-soft">
                {current.bundleId ?? current.externalId}
                {ATTENTION[current.status] && (
                  <span className="font-medium text-ink"> · The key {ATTENTION[current.status]}; replace it.</span>
                )}
              </span>
            </span>
            {!replacing && (
              <span className="flex gap-2">
                <Button className="px-3 py-1" onClick={() => setReplacing(true)}>
                  Replace key
                </Button>
                <Button
                  className="px-3 py-1"
                  disabled={actions.pending}
                  onClick={() => actions.assign(current.id, null)}
                  aria-label={`Unlink ${current.name}`}
                >
                  Unlink
                </Button>
              </span>
            )}
          </div>
        )}
        {(!current || replacing) && (
          <RevenueCatKeyForm
            app={app}
            replacing={current !== undefined}
            onCancel={() => setReplacing(false)}
            onConnected={(message) => {
              setConnected(message)
              setReplacing(false)
            }}
          />
        )}
        {connected && (
          <p role="status" className="text-sm text-ink-soft">
            {connected}
          </p>
        )}
        {!current && others.length > 0 && (
          <div className="flex flex-wrap gap-2 border-t border-line pt-3">
            <label htmlFor={selectId} className="w-full text-xs text-ink-soft">
              Or use a project that is already connected
            </label>
            <select
              id={selectId}
              value={choice}
              onChange={(event) => setChoice(event.target.value)}
              className="min-w-0 flex-1 rounded-md border border-line bg-surface px-3 py-2"
            >
              <option value="" disabled>
                Choose a project
              </option>
              {others.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.name}
                  {whereNow(asset, appName)}
                </option>
              ))}
            </select>
            <Button disabled={!choice || actions.pending} onClick={() => actions.assign(choice, app.id)}>
              Link
            </Button>
          </div>
        )}
      </div>
    </li>
  )
}

function RevenueCatKeyForm(props: {
  app: AppSummary
  replacing: boolean
  onCancel: () => void
  onConnected: (message: string) => void
}) {
  const connect = useServerFn(connectRevenueCatFn)
  const queryClient = useQueryClient()
  const inputId = useId()
  const [apiKey, setApiKey] = useState('')
  const mutation = useMutation({
    mutationFn: () => connect({ data: { apiKey, appId: props.app.id } }),
    onSuccess: async (result) => {
      if (!result.ok) return
      setApiKey('')
      const project = result.projects[0]
      props.onConnected(
        project
          ? [
              `Connected ${project.name}.`,
              project.movedFrom ? `It fed ${project.movedFrom} until now.` : '',
              project.replaced ? `${project.replaced} now waits on the Apps page.` : '',
              'Its history is being fetched; the numbers appear within a minute.',
            ]
              .filter(Boolean)
              .join(' ')
          : 'Connected.',
      )
      await queryClient.invalidateQueries()
    },
  })
  const result = mutation.data

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        mutation.mutate()
      }}
    >
      <p className="text-xs text-ink-soft">
        In RevenueCat, open the project for {props.app.name}, then Project settings, API keys.
        Create a secret API key, version 2, with read access to Charts &amp; metrics and to Project
        configuration, and paste it here. It is stored encrypted and never shown again.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <label htmlFor={inputId} className="sr-only">
          RevenueCat secret key for {props.app.name}
        </label>
        <input
          id={inputId}
          type="password"
          autoComplete="off"
          required
          minLength={8}
          placeholder="sk_…"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          className="min-w-0 flex-1 rounded-md border border-line bg-surface px-3 py-2"
        />
        <Button type="submit" variant="primary" disabled={mutation.isPending}>
          {mutation.isPending ? 'Connecting…' : props.replacing ? 'Replace key' : 'Connect'}
        </Button>
        {props.replacing && (
          <Button disabled={mutation.isPending} onClick={props.onCancel}>
            Cancel
          </Button>
        )}
      </div>
      <div role="status" className="mt-2 text-sm">
        {mutation.isError && 'Could not reach the dashboard server. Try again.'}
        {result && !result.ok && result.message}
      </div>
    </form>
  )
}
