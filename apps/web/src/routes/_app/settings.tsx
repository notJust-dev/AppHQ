import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { z } from 'zod'
import { Button } from '../../components/Button'
import {
  connectAppStoreFn,
  connectRevenueCatFn,
  loadDemoDataFn,
  removeDemoDataFn,
  runSyncFn,
} from '../../fns/settings'
import { assignMetaAccountFn, startMetaConnectFn } from '../../fns/meta'
import { startTikTokConnectFn, takeConnectResultFn } from '../../fns/tiktok'
import { formatCount, formatDay, formatMoment } from '../../lib/format'
import {
  accountsQuery,
  appsQuery,
  metaAccountsQuery,
  metaSetupQuery,
  syncStatusQuery,
  tiktokSetupQuery,
  type Account,
  type AppSummary,
  type MetaAccount,
  type MetaSetup,
  type SyncRun,
  type TikTokSetup,
} from '../../lib/queries'
import { sourceLabel } from '../../lib/sources'

/** Providers whose account names are worth showing next to the source. */
const NAMED = new Set(['tiktok', 'facebook', 'instagram'])

export const Route = createFileRoute('/_app/settings')({
  // Set by a TikTok or Facebook sign-in when it sends the browser back here.
  validateSearch: z.object({ connected: z.enum(['tiktok', 'meta']).optional().catch(undefined) }),
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(appsQuery()),
      context.queryClient.ensureQueryData(accountsQuery()),
      context.queryClient.ensureQueryData(syncStatusQuery()),
      context.queryClient.ensureQueryData(tiktokSetupQuery()),
      context.queryClient.ensureQueryData(metaSetupQuery()),
      context.queryClient.ensureQueryData(metaAccountsQuery()),
    ]),
  component: SettingsPage,
})

/** How long the page keeps refreshing after something was started in the background. */
const WATCH_MS = 90_000
const WATCH_INTERVAL_MS = 4_000

function SettingsPage() {
  const queryClient = useQueryClient()

  // A sync runs in the background on the API, so after starting one the lists are refreshed
  // for a while instead of leaving the page showing the state from before.
  const [watching, setWatching] = useState(false)
  useEffect(() => {
    if (!watching) return
    const timer = setTimeout(() => setWatching(false), WATCH_MS)
    return () => clearTimeout(timer)
  }, [watching])
  const refetchInterval = watching ? WATCH_INTERVAL_MS : false

  const { data: apps } = useSuspenseQuery({ ...appsQuery(), refetchInterval })
  const { data: accounts } = useSuspenseQuery({ ...accountsQuery(), refetchInterval })
  const { data: runs } = useSuspenseQuery({ ...syncStatusQuery(), refetchInterval })
  const { data: tiktokSetup } = useSuspenseQuery(tiktokSetupQuery())
  const { data: metaSetup } = useSuspenseQuery(metaSetupQuery())
  const { data: metaAccounts } = useSuspenseQuery({ ...metaAccountsQuery(), refetchInterval })

  const dataChanged = () => {
    setWatching(true)
    // Covers the portfolio too, so it does not show totals from before the change.
    void queryClient.invalidateQueries()
  }

  return (
    <div className="max-w-3xl">
      <h1 className="font-display text-3xl font-semibold tracking-tight">Settings</h1>
      <ConnectResult onConnected={dataChanged} />

      <Section title="Apps">
        <AppsList apps={apps} />
      </Section>

      <Section
        title="Connect RevenueCat"
        intro="Paste a v2 secret key from a RevenueCat project. The app is added from that project and about a year of its revenue history is fetched. The key needs read access to charts and metrics, and to project configuration."
      >
        <ConnectRevenueCat onConnected={dataChanged} />
      </Section>

      <Section
        title="Connect App Store Connect"
        intro="Downloads come from Apple's daily sales report. Create a team API key in App Store Connect under Users and Access, Integrations. The Sales and Reports role is enough for downloads. With an Admin key the dashboard also asks Apple to start analytics reports, which bring impressions and page views later."
      >
        <ConnectAppStore
          account={accounts.find((account) => account.provider === 'app_store')}
          onConnected={dataChanged}
        />
      </Section>

      <Section
        title="Connect TikTok"
        intro="Connect each TikTok account to the app it promotes. Every sync reads the account's public videos and their totals. TikTok keeps no daily history, so daily views start the day after an account is connected: the sooner it is connected, the more history the charts have."
      >
        <ConnectTikTok apps={apps} setup={tiktokSetup} />
      </Section>

      <Section
        title="Connect Facebook and Instagram"
        intro="One sign-in, with Facebook or Instagram, finds the Pages and Instagram accounts you share with the dashboard. Then choose the app each one promotes. Facebook brings up to a year of daily views, reach and followers; Instagram brings 90 days of daily views. Both bring posts and reels with their views."
      >
        <ConnectMeta apps={apps} setup={metaSetup} accounts={metaAccounts} onChanged={dataChanged} />
      </Section>

      <Section
        title="Sync"
        intro="Every connected source is fetched on a schedule. A sync re-reads the last seven days, so late corrections are picked up."
      >
        <SyncStatus runs={runs} onStarted={dataChanged} />
      </Section>

      <Section
        title="Demo data"
        intro="Four made-up apps with 200 days of numbers and posts, for trying the dashboard or recording it without real figures on screen. Removing them leaves your own apps untouched."
      >
        <DemoData onChanged={dataChanged} />
      </Section>
    </div>
  )
}

function Section(props: { title: string; intro?: string; children: ReactNode }) {
  return (
    <section className="mt-12">
      <h2 className="font-display text-xl font-semibold tracking-tight">{props.title}</h2>
      {props.intro && <p className="mt-2 text-sm text-ink-soft">{props.intro}</p>}
      <div className="mt-4">{props.children}</div>
    </section>
  )
}

const CONNECTION_STATUS: Record<string, string> = {
  ok: 'Connected',
  needs_reauth: 'Needs connecting again',
  error: 'Last sync failed',
}

const PROVIDER_NAMES = { tiktok: 'TikTok', meta: 'Facebook and Instagram' } as const

/** The outcome of a sign-in, read once when the browser comes back from the provider. */
function ConnectResult({ onConnected }: { onConnected: () => void }) {
  const { connected } = Route.useSearch()
  const navigate = useNavigate()
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
      .catch(() => setResult({ ok: false, message: 'Could not read how the sign-in went. Check the apps list.' }))
    // So a reload does not try to read it again.
    void navigate({ to: '/settings', search: {}, replace: true })
  }, [connected, navigate, onConnected, take])

  if (!result) return null
  return (
    <p
      role="status"
      className={`mt-6 rounded-lg border px-6 py-4 text-sm ${
        result.ok ? 'border-line bg-surface' : 'border-ink bg-surface'
      }`}
    >
      <span className="font-medium">
        {PROVIDER_NAMES[result.provider ?? connected ?? 'tiktok']}
        {result.ok ? ' connected. ' : ' not connected. '}
      </span>
      {result.message}
    </p>
  )
}

const META_PLATFORM = { facebook: 'Facebook Page', instagram: 'Instagram' } as const
/** Without these the Meta connectors cannot read Pages, Page insights or Instagram. */
const META_ESSENTIAL = [
  'pages_show_list',
  'pages_read_engagement',
  'read_insights',
  'instagram_basic',
  'instagram_manage_insights',
]
/** Warn this long before the Facebook sign-in, and with it Instagram, stops working. */
const RENEW_WARNING_MS = 10 * 86_400_000

function ConnectMeta(props: {
  apps: AppSummary[]
  setup: MetaSetup
  accounts: MetaAccount[]
  onChanged: () => void
}) {
  const start = useServerFn(startMetaConnectFn)
  const assign = useServerFn(assignMetaAccountFn)
  const connect = useMutation({
    mutationFn: () => start(),
    onSuccess: (result) => {
      if (result.ok) window.location.assign(result.url)
    },
  })
  const choose = useMutation({
    mutationFn: (input: { connectionId: string; appId: string | null }) => assign({ data: input }),
    onSuccess: (result) => {
      if (result.ok) props.onChanged()
    },
  })
  const leaving = connect.isPending || connect.data?.ok === true

  const renewBy = props.accounts
    .filter((account) => account.provider === 'instagram' && account.expiresAt)
    .map((account) => account.expiresAt ?? '')
    .sort()[0]
  const renewSoon = renewBy !== undefined && Date.parse(renewBy) - Date.now() < RENEW_WARNING_MS
  // What the latest sign-in was granted, as Meta reported it; unknown for older connections.
  const granted = props.accounts.find((account) => account.scopes !== null)?.scopes ?? null
  const missing = granted ? META_ESSENTIAL.filter((scope) => !granted.includes(scope)) : []

  return (
    <>
      {props.accounts.length > 0 && (
        <div className="mb-5 overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left text-ink-soft">
                <th scope="col" className="px-6 py-3 font-medium">
                  Account
                </th>
                <th scope="col" className="px-6 py-3 font-medium">
                  Promotes
                </th>
                <th scope="col" className="px-6 py-3 font-medium">
                  State
                </th>
              </tr>
            </thead>
            <tbody>
              {props.accounts.map((account) => {
                const selectId = `meta-app-${account.id}`
                const platform =
                  META_PLATFORM[account.provider as keyof typeof META_PLATFORM] ?? account.provider
                return (
                  <tr key={account.id} className="border-b border-line align-top last:border-b-0">
                    <th scope="row" className="px-6 py-4 text-left font-medium">
                      <label htmlFor={selectId}>{account.displayName ?? platform}</label>
                      <span className="block text-xs font-normal text-ink-soft">{platform}</span>
                    </th>
                    <td className="px-6 py-4">
                      <select
                        id={selectId}
                        value={account.appId ?? ''}
                        disabled={choose.isPending}
                        onChange={(event) =>
                          choose.mutate({
                            connectionId: account.id,
                            appId: event.target.value === '' ? null : event.target.value,
                          })
                        }
                        className="w-full max-w-56 rounded-md border border-line bg-surface px-3 py-2"
                      >
                        <option value="">Not tracked</option>
                        {props.apps.map((app) => (
                          <option key={app.id} value={app.id}>
                            {app.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-6 py-4">
                      {account.appId === null
                        ? 'Not tracked'
                        : (CONNECTION_STATUS[account.status] ?? account.status)}
                      {account.appId !== null && account.lastSyncedAt && (
                        <span className="block text-xs text-ink-soft">
                          Synced {formatMoment(account.lastSyncedAt)}
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {choose.data && !choose.data.ok && (
        <p role="status" className="mb-4 text-sm">
          {choose.data.message}
        </p>
      )}

      {missing.length > 0 && (
        <p className="mb-4 rounded-lg border border-ink bg-surface px-6 py-4 text-sm">
          <span className="font-medium">Missing permissions. </span>
          The sign-in was not granted {missing.map((scope) => <code key={scope}>{scope} </code>)}
          so some numbers cannot be read. Add them to the login configuration in the Meta app
          (Facebook Login for Business, Configurations), then press Connect again.
        </p>
      )}

      {renewBy && (
        <p className={`mb-4 text-sm ${renewSoon ? 'font-medium' : 'text-ink-soft'}`}>
          Meta lets the sign-in last about 60 days. Connect again by {formatDay(renewBy.slice(0, 10))}{' '}
          so Instagram keeps syncing; Facebook Pages keep working either way.
        </p>
      )}

      {!props.setup.configured ? (
        <p className="rounded-lg border border-line bg-surface px-6 py-5 text-sm">
          Facebook and Instagram are not set up on the API yet. Add <code>META_APP_ID</code>,{' '}
          <code>META_APP_SECRET</code> and <code>META_LOGIN_CONFIG_ID</code> from your Meta app to
          the api app&apos;s environment variables, then reload this page.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" onClick={() => connect.mutate()} disabled={leaving}>
            {leaving
              ? 'Opening Facebook…'
              : props.accounts.length > 0
                ? 'Connect again'
                : 'Connect Facebook and Instagram'}
          </Button>
          <span role="status" className="text-sm">
            {connect.isError && 'Could not reach the dashboard server. Try again.'}
            {connect.data && !connect.data.ok && connect.data.message}
          </span>
        </div>
      )}

      <p className="mt-4 text-xs text-ink-soft">
        Valid OAuth Redirect URI to add in the Meta app, exactly as written:{' '}
        <code className="break-all text-ink">{props.setup.redirectUri}</code>
      </p>
    </>
  )
}

function ConnectTikTok(props: { apps: AppSummary[]; setup: TikTokSetup }) {
  const start = useServerFn(startTikTokConnectFn)
  const [appId, setAppId] = useState(props.apps[0]?.id ?? '')
  const mutation = useMutation({
    mutationFn: () => start({ data: { appId } }),
    onSuccess: (result) => {
      if (result.ok) window.location.assign(result.url)
    },
  })
  const result = mutation.data
  const leaving = mutation.isPending || result?.ok === true

  const accounts = props.apps.flatMap((app) =>
    app.connections
      .filter((connection) => connection.provider === 'tiktok')
      .map((connection) => ({ ...connection, appName: app.name })),
  )

  return (
    <>
      {accounts.length > 0 && (
        <ul className="mb-5 divide-y divide-line rounded-lg border border-line bg-surface text-sm">
          {accounts.map((account) => (
            <li key={account.id} className="px-6 py-4">
              <span className="font-medium">{account.displayName ?? 'TikTok account'}</span> for{' '}
              {account.appName}: {CONNECTION_STATUS[account.status] ?? account.status}
              {account.lastSyncedAt && (
                <span className="block text-xs text-ink-soft">
                  Synced {formatMoment(account.lastSyncedAt)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {!props.setup.configured ? (
        <p className="rounded-lg border border-line bg-surface px-6 py-5 text-sm">
          TikTok is not set up on the API yet. Add <code>TIKTOK_CLIENT_KEY</code> and{' '}
          <code>TIKTOK_CLIENT_SECRET</code> from your TikTok app (a sandbox has its own pair) to the
          api app&apos;s environment variables, then reload this page.
        </p>
      ) : props.apps.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface px-6 py-5 text-sm text-ink-soft">
          Add an app first: a TikTok account is always connected to the app it promotes.
        </p>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            mutation.mutate()
          }}
        >
          <label htmlFor="tiktok-app" className="text-sm font-medium">
            App this account promotes
          </label>
          <div className="mt-2 flex flex-wrap gap-3">
            <select
              id="tiktok-app"
              value={appId}
              onChange={(event) => setAppId(event.target.value)}
              className="min-w-0 flex-1 rounded-md border border-line bg-surface px-3 py-2"
            >
              {props.apps.map((app) => (
                <option key={app.id} value={app.id}>
                  {app.name}
                </option>
              ))}
            </select>
            <Button type="submit" variant="primary" disabled={leaving}>
              {leaving ? 'Opening TikTok…' : 'Connect TikTok'}
            </Button>
          </div>
          <p className="mt-2 text-xs text-ink-soft">
            You sign in on TikTok itself and come back here. With a sandbox app, sign in with an
            account added to the sandbox as a target user.
          </p>
          <div role="status" className="mt-3 text-sm">
            {mutation.isError && 'Could not reach the dashboard server. Try again.'}
            {result && !result.ok && result.message}
          </div>
        </form>
      )}

      <p className="mt-4 text-xs text-ink-soft">
        Redirect URI to register in the TikTok app, exactly as written:{' '}
        <code className="break-all text-ink">{props.setup.redirectUri}</code>
      </p>
    </>
  )
}

function AppsList({ apps }: { apps: AppSummary[] }) {
  if (apps.length === 0) {
    return (
      <p className="rounded-lg border border-line bg-surface px-6 py-5 text-sm text-ink-soft">
        No apps yet. Connect RevenueCat below to add your first one.
      </p>
    )
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full min-w-[560px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-line text-left text-ink-soft">
            <th scope="col" className="px-6 py-3 font-medium">
              App
            </th>
            <th scope="col" className="px-6 py-3 font-medium">
              Data from
            </th>
            <th scope="col" className="px-6 py-3 font-medium">
              Connections
            </th>
          </tr>
        </thead>
        <tbody>
          {apps.map((app) => (
            <tr key={app.id} className="border-b border-line align-top last:border-b-0">
              <th scope="row" className="px-6 py-4 text-left font-medium">
                <Link
                  to="/apps/$appId"
                  params={{ appId: app.id }}
                  className="underline decoration-line underline-offset-4 hover:decoration-ink"
                >
                  {app.name}
                </Link>
                <span className="block text-xs font-normal text-ink-soft">{app.id}</span>
              </th>
              <td className="px-6 py-4">
                {app.sources.length === 0 ? (
                  <span className="text-ink-soft">Nothing yet</span>
                ) : (
                  app.sources.map(sourceLabel).join(', ')
                )}
              </td>
              <td className="px-6 py-4">
                {app.connections.length === 0 ? (
                  <span className="text-ink-soft">None</span>
                ) : (
                  app.connections.map((connection) => (
                    <span key={connection.id} className="block">
                      {sourceLabel(connection.provider)}
                      {NAMED.has(connection.provider) && connection.displayName
                        ? ` ${connection.displayName}`
                        : ''}
                      : {CONNECTION_STATUS[connection.status] ?? connection.status}
                      {connection.lastSyncedAt && (
                        <span className="block text-xs text-ink-soft">
                          Synced {formatMoment(connection.lastSyncedAt)}
                        </span>
                      )}
                    </span>
                  ))
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ConnectRevenueCat({ onConnected }: { onConnected: () => void }) {
  const connect = useServerFn(connectRevenueCatFn)
  const [apiKey, setApiKey] = useState('')
  const mutation = useMutation({
    mutationFn: (key: string) => connect({ data: { apiKey: key } }),
    onSuccess: (result) => {
      if (!result.ok) return
      setApiKey('')
      onConnected()
    },
  })
  const result = mutation.data

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        mutation.mutate(apiKey)
      }}
    >
      <label htmlFor="revenuecat-key" className="text-sm font-medium">
        RevenueCat secret key
      </label>
      <div className="mt-2 flex flex-wrap gap-3">
        <input
          id="revenuecat-key"
          name="revenuecat-key"
          type="password"
          autoComplete="off"
          required
          minLength={8}
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          aria-describedby="revenuecat-key-note"
          className="min-w-0 flex-1 rounded-md border border-line bg-surface px-3 py-2"
        />
        <Button type="submit" variant="primary" disabled={mutation.isPending}>
          {mutation.isPending ? 'Connecting…' : 'Connect RevenueCat'}
        </Button>
      </div>
      <p id="revenuecat-key-note" className="mt-2 text-xs text-ink-soft">
        Stored encrypted on the API. It is not shown again and never reaches the browser after this.
      </p>
      <div role="status" className="mt-3 text-sm">
        {mutation.isError && 'Could not reach the dashboard server. Try again.'}
        {result && !result.ok && result.message}
        {result?.ok &&
          `Connected ${result.apps.map((app) => app.name).join(', ')}. Its history is being fetched; the numbers appear within a minute.`}
      </div>
    </form>
  )
}

function ConnectAppStore(props: { account: Account | undefined; onConnected: () => void }) {
  const connect = useServerFn(connectAppStoreFn)
  const empty = { issuerId: '', keyId: '', vendorNumber: '', privateKey: '' }
  const [fields, setFields] = useState(empty)
  const set = (name: keyof typeof empty) => (event: { target: { value: string } }) =>
    setFields((current) => ({ ...current, [name]: event.target.value }))

  const mutation = useMutation({
    mutationFn: () => connect({ data: fields }),
    onSuccess: (result) => {
      if (!result.ok) return
      setFields(empty)
      props.onConnected()
    },
  })
  const result = mutation.data
  const inputClass = 'mt-2 block w-full rounded-md border border-line bg-surface px-3 py-2'

  return (
    <>
      {props.account && (
        <p className="mb-5 rounded-lg border border-line bg-surface px-6 py-4 text-sm">
          {props.account.displayName}: {CONNECTION_STATUS[props.account.status] ?? props.account.status}
          {props.account.lastSyncedAt && (
            <span className="block text-xs text-ink-soft">
              Synced {formatMoment(props.account.lastSyncedAt)}
            </span>
          )}
        </p>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault()
          mutation.mutate()
        }}
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="app-store-issuerId" className="text-sm font-medium">
              Issuer ID
            </label>
            <input
              id="app-store-issuerId"
              type="text"
              autoComplete="off"
              required
              minLength={8}
              value={fields.issuerId}
              onChange={set('issuerId')}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="app-store-keyId" className="text-sm font-medium">
              Key ID
            </label>
            <input
              id="app-store-keyId"
              type="text"
              autoComplete="off"
              required
              minLength={4}
              value={fields.keyId}
              onChange={set('keyId')}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="app-store-vendorNumber" className="text-sm font-medium">
              Vendor number
            </label>
            <input
              id="app-store-vendorNumber"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              required
              pattern="[0-9]{4,15}"
              title="Digits only. It is shown in Payments and Financial Reports."
              value={fields.vendorNumber}
              onChange={set('vendorNumber')}
              className={inputClass}
            />
          </div>
        </div>
        <label htmlFor="app-store-privateKey" className="mt-4 block text-sm font-medium">
          Private key
        </label>
        <textarea
          id="app-store-privateKey"
          rows={5}
          autoComplete="off"
          spellCheck={false}
          required
          minLength={100}
          placeholder="Paste the contents of the .p8 file, including the BEGIN and END lines"
          value={fields.privateKey}
          onChange={set('privateKey')}
          className={`${inputClass} text-xs`}
        />
        <p className="mt-2 text-xs text-ink-soft">
          Stored encrypted on the API. It is not shown again and never reaches the browser after this.
        </p>
        <div className="mt-4">
          <Button type="submit" variant="primary" disabled={mutation.isPending}>
            {mutation.isPending ? 'Connecting…' : 'Connect App Store Connect'}
          </Button>
        </div>
        <div role="status" className="mt-3 text-sm">
          {mutation.isError && 'Check the four fields, then try again.'}
          {result && !result.ok && result.message}
          {result?.ok && <AppStoreConnected result={result} />}
        </div>
      </form>
    </>
  )
}

function AppStoreConnected(props: {
  result: {
    apps: number
    created: number
    analytics: { requested: number; existing: number; problem: string | null }
  }
}) {
  const { apps, created, analytics } = props.result
  return (
    <>
      <p>
        Connected. {apps} {apps === 1 ? 'app' : 'apps'} found
        {created > 0 && `, ${created} new to the dashboard`}. A year of downloads is being fetched;
        the numbers appear within a few minutes.
      </p>
      <p className="mt-2">
        {analytics.problem
          ? `Analytics reports were not requested. ${analytics.problem} Downloads are not affected.`
          : analytics.requested > 0
            ? `Analytics reports were requested for ${analytics.requested} ${analytics.requested === 1 ? 'app' : 'apps'}. Apple starts delivering them in one to two days.`
            : 'Analytics reports were already requested for every app.'}
      </p>
    </>
  )
}

const RUN_STATUS: Record<string, string> = { ok: 'Succeeded', error: 'Failed', running: 'Running' }

function SyncStatus({ runs, onStarted }: { runs: SyncRun[]; onStarted: () => void }) {
  const runSync = useServerFn(runSyncFn)
  const mutation = useMutation({ mutationFn: () => runSync(), onSuccess: onStarted })

  return (
    <>
      {runs.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface px-6 py-5 text-sm text-ink-soft">
          Nothing has synced yet.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left text-ink-soft">
                <th scope="col" className="px-6 py-3 font-medium">
                  Source
                </th>
                <th scope="col" className="px-6 py-3 font-medium">
                  Last run
                </th>
                <th scope="col" className="px-6 py-3 font-medium">
                  Result
                </th>
                <th scope="col" className="px-6 py-3 text-right font-medium">
                  Rows written
                </th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.source} className="border-b border-line align-top last:border-b-0">
                  <th scope="row" className="px-6 py-4 text-left font-medium">
                    {sourceLabel(run.source)}
                  </th>
                  <td className="figures px-6 py-4">{formatMoment(run.startedAt)}</td>
                  <td className="px-6 py-4">
                    {RUN_STATUS[run.status] ?? run.status}
                    {run.error && (
                      <span className="mt-1 block text-xs text-ink-soft">{run.error}</span>
                    )}
                  </td>
                  <td className="figures px-6 py-4 text-right">{formatCount(run.rowsWritten)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
          Sync now
        </Button>
        <span role="status" className="text-sm text-ink-soft">
          {mutation.isSuccess && 'Sync started. This table updates as sources finish.'}
          {mutation.isError && 'Could not start the sync. Try again.'}
        </span>
      </div>
    </>
  )
}

function DemoData({ onChanged }: { onChanged: () => void }) {
  const loadDemo = useServerFn(loadDemoDataFn)
  const removeDemo = useServerFn(removeDemoDataFn)
  const [message, setMessage] = useState('')
  const done = (text: string) => {
    setMessage(text)
    onChanged()
  }
  const failed = () => setMessage('That did not work. Try again.')

  const load = useMutation({
    mutationFn: () => loadDemo(),
    onSuccess: () => done('Demo data loaded.'),
    onError: failed,
  })
  const remove = useMutation({
    mutationFn: () => removeDemo(),
    onSuccess: (result) =>
      done(result.apps === 0 ? 'There was no demo data.' : `Removed ${result.apps} demo apps.`),
    onError: failed,
  })
  const busy = load.isPending || remove.isPending

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button onClick={() => load.mutate()} disabled={busy}>
        {load.isPending ? 'Loading…' : 'Load demo data'}
      </Button>
      <Button onClick={() => remove.mutate()} disabled={busy}>
        {remove.isPending ? 'Removing…' : 'Remove demo data'}
      </Button>
      <span role="status" className="text-sm text-ink-soft">
        {!busy && message}
      </span>
    </div>
  )
}
