import { useMutation, useSuspenseQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import type { ReactNode } from 'react'
import { AlertTriangle, ChevronRight, Clock, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import {
  CONNECTION_STATUS,
  SOURCES,
  Section,
  emptyFamily,
  useWatch,
} from '@/components/integrations/shared'
import { Panel } from '@/components/Panel'
import { Private } from '@/components/Private'
import { SettingsPage } from '@/components/SettingsPage'
import { FamilyLogo, SourceLogo } from '@/components/SourceLogo'
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
import { BRAND_LOGOS } from '@/lib/brand-logos'
import { sourceLabel } from '@/lib/sources'

export const Route = createFileRoute('/_app/settings/integrations/')({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(accountsQuery()),
      context.queryClient.ensureQueryData(syncStatusQuery()),
    ]),
  component: IntegrationsPage,
})

/** Every integration on one screen: whether it is connected, what it found, and what needs you. */
function IntegrationsPage() {
  const watch = useWatch()
  const { data: families } = useSuspenseQuery({ ...accountsQuery(), refetchInterval: watch.refetchInterval })
  const { data: runs } = useSuspenseQuery({ ...syncStatusQuery(), refetchInterval: watch.refetchInterval })
  const family = (name: AccountFamily['family']) =>
    families.find((entry) => entry.family === name) ?? emptyFamily(name)
  const waiting = families.reduce((sum, entry) => sum + entry.assets.waiting, 0)

  return (
    <SettingsPage
      title="Integrations"
      description={
        <>
          Connect each service once. What it finds, its apps, Pages and social accounts, is linked
          to your apps on the{' '}
          <Link to="/settings/apps" className="font-medium text-foreground underline underline-offset-4">
            Apps page
          </Link>
          .
        </>
      }
    >
      {waiting > 0 && (
        <Alert variant="warning">
          <AlertTriangle aria-hidden="true" />
          <AlertTitle>
            {formatCount(waiting)} {waiting === 1 ? 'thing waits' : 'things wait'} for a decision
          </AlertTitle>
          <AlertDescription>
            <Link to="/settings/apps">{waiting === 1 ? 'Link it on the Apps page' : 'Link them on the Apps page'}</Link>
          </AlertDescription>
        </Alert>
      )}

      <Panel title="Services" bodyClassName="">
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
        intro="Every connected service is fetched on a schedule. A sync re-reads the last seven days, so late corrections are picked up."
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
    </SettingsPage>
  )
}

/** One integration: the whole row links to its page, with its state in a line. */
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

  const who = connected ? whoIsConnected(family) : null
  const parts = connected
    ? [
        assets.total > 0 && source.family !== 'meta' && source.family !== 'tiktok' && source.family !== 'youtube'
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
          <FamilyLogo family={source.family} className={source.family === 'meta' ? 'size-3.5' : 'size-4'} />
        </ItemMedia>
        <ItemContent className="min-w-0 basis-56">
          <ItemTitle>{source.title}</ItemTitle>
          <ItemDescription className="break-words">
            {/* Names of accounts are private; a count of them is not. */}
            {who && (who.named ? <Private>{who.text}</Private> : who.text)}
            {who && parts.length > 0 && ' · '}
            {parts.join(' · ')}
          </ItemDescription>
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

/** Who is signed in, as briefly as the list allows, and whether that names them. */
function whoIsConnected({ family, accounts }: AccountFamily): { text: string; named: boolean } {
  const names = accounts.map((account) => account.displayName ?? sourceLabel(account.provider))
  switch (family) {
    case 'meta': {
      const pages = accounts.filter((account) => account.provider === 'facebook').length
      const instagram = accounts.filter((account) => account.provider === 'instagram').length
      const text = [
        pages > 0 ? `${pages} ${pages === 1 ? 'Page' : 'Pages'}` : null,
        instagram > 0 ? `${instagram} Instagram ${instagram === 1 ? 'account' : 'accounts'}` : null,
      ]
        .filter(Boolean)
        .join(' and ')
      return { text, named: false }
    }
    case 'revenuecat':
      return names.length <= 2 ? { text: names.join(', '), named: true } : { text: `${names.length} projects`, named: false }
    default:
      return names.length <= 2 ? { text: names.join(', '), named: true } : { text: `${names.length} accounts`, named: false }
  }
}

/** The one thing about an integration that needs the person, if any. */
function attentionOf(family: AccountFamily): ReactNode {
  const broken = family.accounts.find((account) => account.status !== 'ok')
  if (broken) {
    const what = `${(CONNECTION_STATUS[broken.status] ?? broken.status).toLowerCase()}.`
    if (!broken.displayName) return `${sourceLabel(broken.provider)}: ${what}`
    return (
      <>
        <Private>{broken.displayName}</Private>: {what}
      </>
    )
  }
  const noted = family.accounts.find((account) => account.note)
  if (noted?.note) return noted.note
  if (family.family === 'meta' && family.accounts.length > 0) {
    const { missing, renewBy, renewSoon, ended } = metaHealth(family.accounts)
    if (missing.length > 0) return 'Missing permissions, so some numbers cannot be read.'
    if (renewBy && ended) return `The sign-in ended on ${formatDay(renewBy.slice(0, 10))}, so Instagram stopped syncing. Sign in again.`
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
      toast.success('Sync started. The table updates as services finish.')
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
              <TableHead scope="col">Service</TableHead>
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
                <TableRowHead>
                  <span className="inline-flex items-center gap-2">
                    {/* The cron check has no brand: a clock instead, so the names line up. */}
                    {BRAND_LOGOS[run.source] ? (
                      <SourceLogo source={run.source} decorative className="size-4 text-muted-foreground" />
                    ) : (
                      <Clock aria-hidden="true" className="size-4 text-muted-foreground" />
                    )}
                    {sourceLabel(run.source)}
                  </span>
                </TableRowHead>
                <TableCell className="figures">{formatMoment(run.startedAt)}</TableCell>
                <TableCell>
                  <Status tone={run.status === 'error' ? 'danger' : 'ok'}>{RUN_STATUS[run.status] ?? run.status}</Status>
                  {/* An error can name an app or account. */}
                  {run.error && (
                    <span data-private="" className="mt-1 block text-xs text-muted-foreground">
                      {run.error}
                    </span>
                  )}
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
