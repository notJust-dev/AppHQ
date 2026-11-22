import { useMutation, useSuspenseQuery } from '@tanstack/react-query'
import { Link, createFileRoute, redirect } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { z } from 'zod'
import { Button } from '../../components/Button'
import {
  CONNECTION_STATUS,
  SOURCES,
  Section,
  emptyFamily,
  useWatch,
} from '../../components/accounts/shared'
import { loadDemoDataFn, removeDemoDataFn, runSyncFn } from '../../fns/settings'
import { formatCount, formatDay, formatMoment } from '../../lib/format'
import { metaHealth } from '../../lib/meta'
import { accountsQuery, syncStatusQuery, type AccountFamily, type SyncRun } from '../../lib/queries'
import { sourceLabel } from '../../lib/sources'

export const Route = createFileRoute('/_app/accounts/')({
  // Older sign-ins came back here; their source's page now reads the outcome.
  validateSearch: z.object({ connected: z.enum(['tiktok', 'meta']).optional().catch(undefined) }),
  beforeLoad: ({ search }) => {
    if (search.connected === 'tiktok') throw redirect({ to: '/accounts/tiktok', search: { connected: 'tiktok' } })
    if (search.connected === 'meta') throw redirect({ to: '/accounts/meta', search: { connected: 'meta' } })
  },
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(accountsQuery()),
      context.queryClient.ensureQueryData(syncStatusQuery()),
    ]),
  component: AccountsPage,
})

/** Every source on one screen: whether it is connected, what it found, and what needs you. */
function AccountsPage() {
  const watch = useWatch()
  const { data: families } = useSuspenseQuery({ ...accountsQuery(), refetchInterval: watch.refetchInterval })
  const { data: runs } = useSuspenseQuery({ ...syncStatusQuery(), refetchInterval: watch.refetchInterval })
  const family = (name: AccountFamily['family']) =>
    families.find((entry) => entry.family === name) ?? emptyFamily(name)
  const waiting = families.reduce((sum, entry) => sum + entry.assets.waiting, 0)

  return (
    <div className="max-w-3xl">
      <h1 className="font-display text-3xl font-semibold tracking-tight">Accounts</h1>
      <p className="mt-2 text-ink-soft">
        Sign in to each source once. What an account finds, its apps, Pages and social accounts, is
        linked to your apps on the{' '}
        <Link to="/apps" className="font-medium text-ink underline underline-offset-4">
          Apps page
        </Link>
        .
      </p>

      {waiting > 0 && (
        <p className="mt-6 rounded-lg border border-ink bg-surface px-6 py-4 text-sm">
          <span className="font-medium">
            {formatCount(waiting)} {waiting === 1 ? 'thing waits' : 'things wait'} for a decision.
          </span>{' '}
          <Link to="/apps" className="font-medium underline underline-offset-4">
            {waiting === 1 ? 'Link it on the Apps page' : 'Link them on the Apps page'}
          </Link>
        </p>
      )}

      <ul className="mt-8 divide-y divide-line rounded-lg border border-line bg-surface">
        {SOURCES.map((source) => (
          <SourceRow key={source.family} source={source} family={family(source.family)} />
        ))}
      </ul>

      <Section
        title="Sync"
        intro="Every connected source is fetched on a schedule. A sync re-reads the last seven days, so late corrections are picked up."
      >
        <SyncStatus runs={runs} onStarted={watch.dataChanged} />
      </Section>

      <Section
        title="Demo data"
        intro="Four made-up apps with 200 days of numbers and posts, for trying the dashboard or recording it without real figures on screen. Removing them leaves your own apps untouched."
      >
        <DemoData onChanged={watch.dataChanged} />
      </Section>
    </div>
  )
}

/** One source: a link to its page, with its state in a line. */
function SourceRow(props: { source: (typeof SOURCES)[number]; family: AccountFamily }) {
  const { source, family } = props
  const { accounts, assets } = family
  const connected = accounts.length > 0
  const attention = attentionOf(family)
  const lastSync = accounts
    .map((account) => account.lastSyncedAt)
    .filter((at): at is string => at !== null)
    .sort()
    .at(-1)

  const parts = connected
    ? [
        whoIsConnected(family),
        assets.total > 0 && source.family !== 'meta' && source.family !== 'tiktok'
          ? `${formatCount(assets.total)} ${assets.total === 1 ? source.noun[0] : source.noun[1]}`
          : null,
        assets.waiting > 0 ? `${formatCount(assets.waiting)} waiting for a decision` : null,
        lastSync ? `synced ${formatMoment(lastSync)}` : null,
      ].filter((part): part is string => Boolean(part))
    : [source.brings]

  return (
    <li className="relative flex flex-wrap items-center gap-x-6 gap-y-3 px-6 py-5 has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-views hover:bg-paper">
      <div className="min-w-0 flex-1 basis-64">
        <h2 className="font-medium">
          {/* The link covers the whole row, so the row is one big target. */}
          <Link to={source.to} className="after:absolute after:inset-0 focus-visible:outline-none">
            {source.title}
          </Link>
        </h2>
        <p className="mt-1 text-sm break-words text-ink-soft">{parts.join(' · ')}</p>
        {attention && <p className="mt-1 text-sm font-medium">{attention}</p>}
      </div>
      <span className={`text-sm ${attention ? 'font-medium' : 'text-ink-soft'}`}>
        {connected ? (attention ? 'Needs attention' : 'Connected') : 'Not connected'}
      </span>
      <span
        aria-hidden="true"
        className={`rounded-md px-4 py-2 text-sm font-medium ${
          connected ? 'border border-line bg-surface' : 'bg-ink text-surface'
        }`}
      >
        {connected ? 'Configure' : 'Connect'}
      </span>
    </li>
  )
}

/** Who is signed in, as briefly as the list allows. */
function whoIsConnected({ family, accounts }: AccountFamily): string {
  const names = accounts.map((account) => account.displayName ?? sourceLabel(account.provider))
  switch (family) {
    case 'meta': {
      const pages = accounts.filter((account) => account.provider === 'facebook').length
      const instagram = accounts.filter((account) => account.provider === 'instagram').length
      return [
        pages > 0 ? `${pages} ${pages === 1 ? 'Page' : 'Pages'}` : null,
        instagram > 0 ? `${instagram} Instagram ${instagram === 1 ? 'account' : 'accounts'}` : null,
      ]
        .filter(Boolean)
        .join(' and ')
    }
    case 'revenuecat':
      return names.length <= 2 ? names.join(', ') : `${names.length} projects`
    default:
      return names.length <= 2 ? names.join(', ') : `${names.length} accounts`
  }
}

/** The one thing about a source that needs the person, if any. */
function attentionOf(family: AccountFamily): string | null {
  const broken = family.accounts.find((account) => account.status !== 'ok')
  if (broken) {
    const who = broken.displayName ?? sourceLabel(broken.provider)
    return `${who}: ${(CONNECTION_STATUS[broken.status] ?? broken.status).toLowerCase()}.`
  }
  if (family.family === 'meta' && family.accounts.length > 0) {
    const { missing, renewBy, renewSoon } = metaHealth(family.accounts)
    if (missing.length > 0) return 'Missing permissions, so some numbers cannot be read.'
    if (renewBy && renewSoon) return `Sign in again by ${formatDay(renewBy.slice(0, 10))} so Instagram keeps syncing.`
  }
  return null
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
                    {run.error && <span className="mt-1 block text-xs text-ink-soft">{run.error}</span>}
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
