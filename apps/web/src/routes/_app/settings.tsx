import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { useEffect, useState, type ReactNode } from 'react'
import { Button } from '../../components/Button'
import {
  connectRevenueCatFn,
  loadDemoDataFn,
  removeDemoDataFn,
  runSyncFn,
} from '../../fns/settings'
import { formatCount, formatMoment } from '../../lib/format'
import { appsQuery, syncStatusQuery, type AppSummary, type SyncRun } from '../../lib/queries'
import { sourceLabel } from '../../lib/sources'

export const Route = createFileRoute('/_app/settings')({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(appsQuery()),
      context.queryClient.ensureQueryData(syncStatusQuery()),
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
  const { data: runs } = useSuspenseQuery({ ...syncStatusQuery(), refetchInterval })

  const dataChanged = () => {
    setWatching(true)
    // Covers the portfolio too, so it does not show totals from before the change.
    void queryClient.invalidateQueries()
  }

  return (
    <div className="max-w-3xl">
      <h1 className="font-display text-3xl font-semibold tracking-tight">Settings</h1>

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
        title="Sync"
        intro="Every connected source is fetched on a schedule. A sync re-reads the last seven days, so late corrections are picked up."
      >
        <SyncStatus runs={runs} onStarted={dataChanged} />
      </Section>

      <Section
        title="Demo data"
        intro="Four made-up apps with 200 days of numbers, for trying the dashboard or recording it without real figures on screen. Removing them leaves your own apps untouched."
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
  needs_reauth: 'Needs a new key',
  error: 'Last sync failed',
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
                {app.name}
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
                    <span key={connection.provider} className="block">
                      {sourceLabel(connection.provider)}:{' '}
                      {CONNECTION_STATUS[connection.status] ?? connection.status}
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
