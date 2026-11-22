import { useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { takeConnectResultFn } from '@/fns/tiktok'
import { formatCount, formatMoment } from '@/lib/format'
import type { AccountFamily } from '@/lib/queries'
import { sourceLabel } from '@/lib/sources'
import { CircleAlert, CircleCheck } from 'lucide-react'
import { PageBody, PageHeader } from '@/components/PageHeader'
import { Panel } from '@/components/Panel'
import { Status } from '@/components/Status'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

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
    brings: 'Downloads, store page views and reviews for your iOS apps.',
    noun: ['iOS app', 'iOS apps'],
  },
  {
    family: 'google_play',
    title: 'Google Play',
    to: '/accounts/google-play',
    brings: 'Installs, store listing visitors and reviews for your Android apps.',
    noun: ['Android app', 'Android apps'],
  },
  {
    family: 'revenuecat',
    title: 'RevenueCat',
    to: '/accounts/revenuecat',
    brings: "Revenue, MRR, trials and subscribers. Each app connects its own project, in the app's Settings.",
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

/** The frame of one source's page: where it sits, what it brings, and its panels. */
export function SourcePage(props: { title: string; intro: string; children: ReactNode }) {
  return (
    <>
      <PageHeader narrow crumbs={[{ label: 'Accounts', to: '/accounts' }]} title={props.title} description={props.intro} />
      <PageBody narrow>{props.children}</PageBody>
    </>
  )
}

/** A panel on a source page. `flush` lets a list run edge to edge. */
export function Section(props: { title: string; intro?: ReactNode; flush?: boolean; children: ReactNode }) {
  return (
    <Panel title={props.title} description={props.intro} bodyClassName={props.flush ? '' : undefined}>
      {props.children}
    </Panel>
  )
}

/** Numbered instructions for getting a key or setting up an app on the source's side. */
export function Steps({ children }: { children: ReactNode }) {
  return (
    <ol className="mb-6 list-decimal space-y-2 pl-5 marker:text-faint">
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
    <p className="border-t px-5 py-3 text-muted-foreground">
      Found {formatCount(total)} {total === 1 ? one : many}: {formatCount(linked)} linked to an app
      {ignored > 0 && `, ${formatCount(ignored)} ignored`}
      {waiting > 0 && (
        <>
          ,{' '}
          <Link to="/apps" className="font-medium text-foreground underline underline-offset-4">
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
    return <p className="px-5 py-4 text-muted-foreground">Not connected yet.</p>
  }
  return (
    <ul className="divide-y">
      {props.accounts.map((account) => {
        const detail = props.detail?.(account)
        return (
          <li key={account.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-5 py-3">
            <span className="min-w-0 break-words">
              <span className="font-medium">{account.displayName ?? sourceLabel(account.provider)}</span>
              {(account.provider === 'facebook' || account.provider === 'instagram') && (
                <span className="text-muted-foreground"> · {sourceLabel(account.provider)}</span>
              )}
              {detail && <span className="block text-xs text-muted-foreground">{detail}</span>}
              {account.note && <span className="mt-1.5 block max-w-prose text-xs text-warning">{account.note}</span>}
            </span>
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Status tone={account.status === 'ok' ? 'ok' : account.status === 'needs_reauth' ? 'danger' : 'warn'}>
                {CONNECTION_STATUS[account.status] ?? account.status}
              </Status>
              {account.lastSyncedAt && (
                <span className="text-xs text-faint">Synced {formatMoment(account.lastSyncedAt)}</span>
              )}
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
  const provider = PROVIDER_NAMES[result.provider ?? connected ?? 'tiktok']
  return (
    <Alert variant={result.ok ? 'default' : 'destructive'} role="status">
      {result.ok ? <CircleCheck aria-hidden="true" /> : <CircleAlert aria-hidden="true" />}
      <AlertTitle>{result.ok ? `${provider} connected` : `${provider} not connected`}</AlertTitle>
      <AlertDescription>{result.message}</AlertDescription>
    </Alert>
  )
}

/** Where to read about the developer-side setup, folded away from everyday use. */
export function DeveloperSetup(props: { summary: string; children: ReactNode }) {
  return (
    <details className="group rounded-xl bg-card px-5 py-3.5 ring-1 ring-foreground/10">
      <summary className="cursor-pointer font-medium marker:text-faint">{props.summary}</summary>
      <div className="mt-3 space-y-3 text-muted-foreground [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs [&_code]:text-foreground">
        {props.children}
      </div>
    </details>
  )
}
