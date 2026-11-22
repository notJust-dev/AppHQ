import { useMutation, useSuspenseQuery } from '@tanstack/react-query'
import { Link, createFileRoute, redirect } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { AlertTriangle, AppWindow, BadgeDollarSign, ChevronRight, Play, RefreshCw, Smartphone, ThumbsUp } from 'lucide-react'
import { toast } from 'sonner'
import { z } from 'zod'
import {
  CONNECTION_STATUS,
  SOURCES,
  Section,
  emptyFamily,
  useWatch,
} from '@/components/accounts/shared'
import { PageBody, PageHeader } from '@/components/PageHeader'
import { Panel } from '@/components/Panel'
import { Status } from '@/components/Status'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button, buttonVariants } from '@/components/ui/button'
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item'
import { Spinner } from '@/components/ui/spinner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableRowHead,
} from '@/components/ui/table'
import { loadDemoDataFn, removeDemoDataFn, runSyncFn } from '@/fns/settings'
import { formatCount, formatDay, formatMoment } from '@/lib/format'
import { metaHealth } from '@/lib/meta'
import { accountsQuery, syncStatusQuery, type AccountFamily, type SyncRun } from '@/lib/queries'
import { sourceLabel } from '@/lib/sources'

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
    <>
      <PageHeader
        narrow
        title="Accounts"
        description={
          <>
            Sign in to each source once. What an account finds, its apps, Pages and social
            accounts, is linked to your apps on the{' '}
            <Link to="/apps" className="font-medium text-foreground underline underline-offset-4">
              Apps page
            </Link>
            .
          </>
        }
      />
      <PageBody narrow>
        {waiting > 0 && (
          <Alert variant="warning">
            <AlertTriangle aria-hidden="true" />
            <AlertTitle>
              {formatCount(waiting)} {waiting === 1 ? 'thing waits' : 'things wait'} for a decision
            </AlertTitle>
            <AlertDescription>
              <Link to="/apps">{waiting === 1 ? 'Link it on the Apps page' : 'Link them on the Apps page'}</Link>
            </AlertDescription>
          </Alert>
        )}

        <Panel title="Sources" bodyClassName="">
          <ul className="divide-y">
            {SOURCES.map((source) => (
              <li key={source.family}>
                <SourceRow source={source} family={family(source.family)} />
              </li>
            ))}
          </ul>
        </Panel>

        <Section
          title="Sync"
          intro="Every connected source is fetched on a schedule. A sync re-reads the last seven days, so late corrections are picked up."
          flush
        >
          <SyncStatus runs={runs} onStarted={watch.dataChanged} />
        </Section>

        <Section
          title="Demo data"
          intro="Four made-up apps with 200 days of numbers and posts, for trying the dashboard or recording it without real figures on screen. Removing them leaves your own apps untouched."
        >
          <DemoData onChanged={watch.dataChanged} />
        </Section>
      </PageBody>
    </>
  )
}

/** One source: the whole row links to its page, with its state in a line. */
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
    <Item asChild className="rounded-none px-5 py-4 focus-visible:ring-inset">
      <Link to={source.to}>
        <ItemMedia className="size-9 rounded-lg border bg-muted text-muted-foreground" aria-hidden="true">
          <SourceIcon family={source.family} />
        </ItemMedia>
        <ItemContent className="min-w-0 basis-56">
          <ItemTitle>{source.title}</ItemTitle>
          <ItemDescription className="break-words">{parts.join(' · ')}</ItemDescription>
          {attention && <p className="max-w-prose text-xs text-warning">{attention}</p>}
        </ItemContent>
        <ItemActions>
          <Status tone={connected ? (attention ? 'warn' : 'ok') : 'off'}>
            {connected ? (attention ? 'Needs attention' : 'Connected') : 'Not connected'}
          </Status>
          {/* The row is the link; this only shows what it does. */}
          <span aria-hidden="true" className={buttonVariants({ variant: connected ? 'outline' : 'default', size: 'sm' })}>
            {connected ? 'Configure' : 'Connect'}
            <ChevronRight />
          </span>
        </ItemActions>
      </Link>
    </Item>
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
  const noted = family.accounts.find((account) => account.note)
  if (noted?.note) return noted.note
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
  const mutation = useMutation({
    mutationFn: () => runSync(),
    onSuccess: () => {
      toast.success('Sync started. The table updates as sources finish.')
      onStarted()
    },
    onError: () => toast.error('Could not start the sync. Try again.'),
  })

  return (
    <>
      {runs.length === 0 ? (
        <p className="px-5 py-4 text-muted-foreground">Nothing has synced yet.</p>
      ) : (
        <Table className="min-w-[560px]">
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Source</TableHead>
              <TableHead scope="col">Last run</TableHead>
              <TableHead scope="col">Result</TableHead>
              <TableHead scope="col" className="text-right">
                Rows written
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.map((run) => (
              <TableRow key={run.source}>
                <TableRowHead>{sourceLabel(run.source)}</TableRowHead>
                <TableCell className="figures">{formatMoment(run.startedAt)}</TableCell>
                <TableCell>
                  <Status tone={run.status === 'error' ? 'danger' : 'ok'}>{RUN_STATUS[run.status] ?? run.status}</Status>
                  {run.error && <span className="mt-1 block text-xs text-muted-foreground">{run.error}</span>}
                </TableCell>
                <TableCell className="figures text-right">{formatCount(run.rowsWritten)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <div className="flex flex-wrap items-center gap-3 border-t bg-muted/50 px-5 py-3">
        <Button variant="outline" size="sm" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
          {mutation.isPending ? <Spinner /> : <RefreshCw aria-hidden="true" />}
          Sync now
        </Button>
      </div>
    </>
  )
}

function DemoData({ onChanged }: { onChanged: () => void }) {
  const loadDemo = useServerFn(loadDemoDataFn)
  const removeDemo = useServerFn(removeDemoDataFn)
  const done = (text: string) => {
    toast.success(text)
    onChanged()
  }
  const failed = () => toast.error('That did not work. Try again.')

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
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" onClick={() => load.mutate()} disabled={busy}>
        {load.isPending && <Spinner />}
        {load.isPending ? 'Loading…' : 'Load demo data'}
      </Button>
      <Button variant="outline" onClick={() => remove.mutate()} disabled={busy}>
        {remove.isPending && <Spinner />}
        {remove.isPending ? 'Removing…' : 'Remove demo data'}
      </Button>
    </div>
  )
}

/** A plain pictogram per source; the names carry the brands. */
function SourceIcon({ family }: { family: AccountFamily['family'] }) {
  const Icon = { app_store: Smartphone, google_play: AppWindow, revenuecat: BadgeDollarSign, meta: ThumbsUp, tiktok: Play }[family]
  return <Icon className="size-4" />
}
