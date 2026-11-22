import { useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { takeConnectResultFn } from '../../fns/tiktok'
import { formatCount, formatMoment } from '../../lib/format'
import type { AccountFamily } from '../../lib/queries'
import { sourceLabel } from '../../lib/sources'

export type ConnectedAccount = AccountFamily['accounts'][number]
export type FamilyName = AccountFamily['family']

/** The sources as people know them, in the order the Accounts page lists them. */
export const SOURCES: {
  family: FamilyName
  title: string
  to:
    | '/accounts/app-store'
    | '/accounts/google-play'
    | '/accounts/revenuecat'
    | '/accounts/meta'
    | '/accounts/tiktok'
  brings: string
  /** What it finds, one and many. */
  noun: [string, string]
}[] = [
  {
    family: 'app_store',
    title: 'App Store Connect',
    to: '/accounts/app-store',
    brings: 'Daily downloads for your iOS apps.',
    noun: ['iOS app', 'iOS apps'],
  },
  {
    family: 'google_play',
    title: 'Google Play',
    to: '/accounts/google-play',
    brings: 'Installs and store listing visitors for your Android apps.',
    noun: ['Android app', 'Android apps'],
  },
  {
    family: 'revenuecat',
    title: 'RevenueCat',
    to: '/accounts/revenuecat',
    brings: 'Revenue, MRR, trials and subscribers.',
    noun: ['project', 'projects'],
  },
  {
    family: 'meta',
    title: 'Facebook and Instagram',
    to: '/accounts/meta',
    brings: 'Page and Instagram views, reach, followers and posts.',
    noun: ['Page or account', 'Pages and accounts'],
  },
  {
    family: 'tiktok',
    title: 'TikTok',
    to: '/accounts/tiktok',
    brings: 'Video views and followers.',
    noun: ['account', 'accounts'],
  },
]

export const sourceOf = (family: FamilyName) => SOURCES.find((source) => source.family === family)!

/** A family with nothing connected, for when the API has not listed it. */
export const emptyFamily = (family: FamilyName): AccountFamily => ({
  family,
  accounts: [],
  assets: { total: 0, linked: 0, waiting: 0, ignored: 0 },
})

export const CONNECTION_STATUS: Record<string, string> = {
  ok: 'Connected',
  needs_reauth: 'Needs connecting again',
  error: 'Last sync failed',
}

/** How long a page keeps refreshing after something was started in the background. */
const WATCH_MS = 90_000
const WATCH_INTERVAL_MS = 4_000

/**
 * A connect or sync runs in the background on the API, so after starting one the page refreshes
 * for a while instead of showing the state from before.
 */
export function useWatch() {
  const queryClient = useQueryClient()
  const [watching, setWatching] = useState(false)
  useEffect(() => {
    if (!watching) return
    const timer = setTimeout(() => setWatching(false), WATCH_MS)
    return () => clearTimeout(timer)
  }, [watching])

  return {
    refetchInterval: watching ? WATCH_INTERVAL_MS : (false as const),
    dataChanged: () => {
      setWatching(true)
      // Covers the portfolio too, so it does not show totals from before the change.
      void queryClient.invalidateQueries()
    },
  }
}

/** The frame of one source's page: the way back, what it brings, and its parts. */
export function SourcePage(props: { title: string; intro: string; children: ReactNode }) {
  return (
    <div className="max-w-3xl">
      <Link to="/accounts" className="text-sm font-medium text-ink-soft hover:text-ink">
        <span aria-hidden="true">← </span>Accounts
      </Link>
      <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight">{props.title}</h1>
      <p className="mt-2 text-ink-soft">{props.intro}</p>
      {props.children}
    </div>
  )
}

export function Section(props: { title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="font-display text-xl font-semibold tracking-tight">{props.title}</h2>
      {props.intro && <p className="mt-2 text-sm text-ink-soft">{props.intro}</p>}
      <div className="mt-4">{props.children}</div>
    </section>
  )
}

/** Numbered instructions for getting a key or setting up an app on the source's side. */
export function Steps({ children }: { children: ReactNode }) {
  return (
    <ol className="mb-6 list-decimal space-y-2 pl-5 text-sm marker:font-medium marker:text-ink-soft">
      {children}
    </ol>
  )
}

/** What a source found, and how much of it still waits for an app. */
export function Found(props: { family: AccountFamily }) {
  const { total, linked, waiting, ignored } = props.family.assets
  if (props.family.accounts.length === 0) return null
  const [one, many] = sourceOf(props.family.family).noun
  return (
    <p className="mt-3 text-sm">
      Found {formatCount(total)} {total === 1 ? one : many}: {formatCount(linked)} linked to an app
      {ignored > 0 && `, ${formatCount(ignored)} ignored`}
      {waiting > 0 && (
        <>
          ,{' '}
          <Link to="/apps" className="font-medium underline underline-offset-4">
            {formatCount(waiting)} waiting for a decision
          </Link>
        </>
      )}
      .
    </p>
  )
}

/** The sign-ins or keys of a source, with their state. */
export function AccountList(props: { accounts: ConnectedAccount[]; detail?: (account: ConnectedAccount) => string | null }) {
  if (props.accounts.length === 0) {
    return (
      <p className="rounded-lg border border-line bg-surface px-6 py-4 text-sm text-ink-soft">
        Not connected yet.
      </p>
    )
  }
  return (
    <ul className="divide-y divide-line rounded-lg border border-line bg-surface text-sm">
      {props.accounts.map((account) => {
        const detail = props.detail?.(account)
        return (
          <li key={account.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-6 py-3">
            <span className="min-w-0 break-words">
              <span className="font-medium">{account.displayName ?? sourceLabel(account.provider)}</span>
              {(account.provider === 'facebook' || account.provider === 'instagram') && (
                <span className="text-ink-soft"> · {sourceLabel(account.provider)}</span>
              )}
              {detail && <span className="block text-xs text-ink-soft">{detail}</span>}
            </span>
            <span className={`text-xs ${account.status === 'ok' ? 'text-ink-soft' : 'font-medium'}`}>
              {CONNECTION_STATUS[account.status] ?? account.status}
              {account.lastSyncedAt && `, synced ${formatMoment(account.lastSyncedAt)}`}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

const PROVIDER_NAMES = { tiktok: 'TikTok', meta: 'Facebook and Instagram' } as const

/**
 * The outcome of a sign-in, read once when the browser comes back from the provider. `clear`
 * drops the marker from the address so a reload does not try to read it again.
 */
export function ConnectResult(props: {
  connected: keyof typeof PROVIDER_NAMES | undefined
  clear: () => void
  onConnected: () => void
}) {
  const { connected, clear, onConnected } = props
  const take = useServerFn(takeConnectResultFn)
  const [result, setResult] = useState<{
    ok: boolean
    message: string
    provider?: keyof typeof PROVIDER_NAMES
  } | null>(null)
  const started = useRef(false)

  useEffect(() => {
    if (!connected || started.current) return
    started.current = true
    take()
      .then((outcome) => {
        setResult(outcome)
        if (outcome?.ok) onConnected()
      })
      .catch(() => setResult({ ok: false, message: 'Could not read how the sign-in went. Check the list below.' }))
    clear()
  }, [connected, clear, onConnected, take])

  if (!result) return null
  return (
    <p
      role="status"
      className={`mt-6 rounded-lg border bg-surface px-6 py-4 text-sm ${result.ok ? 'border-line' : 'border-ink'}`}
    >
      <span className="font-medium">
        {PROVIDER_NAMES[result.provider ?? connected ?? 'tiktok']}
        {result.ok ? ' connected. ' : ' not connected. '}
      </span>
      {result.message}
    </p>
  )
}

/** Where to read about the developer-side setup, folded away from everyday use. */
export function DeveloperSetup(props: { summary: string; children: ReactNode }) {
  return (
    <details className="mt-10 rounded-lg border border-line bg-surface px-6 py-4 text-sm">
      <summary className="cursor-pointer font-medium">{props.summary}</summary>
      <div className="mt-3 space-y-3 text-ink-soft">{props.children}</div>
    </details>
  )
}

export const inputClass = 'mt-2 block w-full rounded-md border border-line bg-surface px-3 py-2'
