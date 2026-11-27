import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { useId, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Panel } from '@/components/Panel'
import { Private } from '@/components/Private'
import { SourceLogo } from '@/components/SourceLogo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { useAssetActions, type AssetActions } from '@/components/useAssetActions'
import { connectRevenueCatFn } from '@/fns/settings'
import {
  ATTENTION,
  KIND_LABEL,
  LOGO_OF_KIND,
  SOURCE_OF_KIND,
  assetDetail,
} from '@/lib/assets'
import type { AppSummary, Asset } from '@/lib/queries'

/**
 * What feeds one app: its iOS app, Android app and RevenueCat project, one of each, and any
 * number of social accounts. Shared accounts hold social accounts only.
 */
export function AppSources(props: { app: AppSummary; apps: AppSummary[]; assets: Asset[] }) {
  const { app, apps, assets } = props
  const actions = useAssetActions()
  const appOf = (appId: string) => apps.find((other) => other.id === appId)
  const mine = assets.filter((asset) => asset.appId === app.id)
  const portfolio = app.kind === 'portfolio'

  return (
    <Panel
      id="sources"
      title="Sources"
      description={
        portfolio
          ? 'Social accounts that promote several apps. Their views count toward the portfolio, not toward one app.'
          : 'What feeds this app. Linking one fetches its history, so the charts fill in a few minutes later.'
      }
      bodyClassName=""
    >
      <ul className="divide-y">
        {!portfolio &&
          STORE_KINDS.map((kind) => (
            <SlotRow
              key={kind}
              kind={kind}
              appId={app.id}
              current={mine.find((asset) => asset.kind === kind)}
              candidates={assets.filter((asset) => asset.kind === kind && !asset.ignored)}
              appOf={appOf}
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
            appOf={appOf}
            actions={actions}
          />
        )}
        <SocialRow
          appId={app.id}
          linked={mine.filter((asset) => asset.social)}
          candidates={assets.filter((asset) => asset.social && !asset.ignored && asset.appId !== app.id)}
          appOf={appOf}
          actions={actions}
        />
      </ul>
    </Panel>
  )
}

/** Store apps and the website come from an account connected once, on the Accounts page. */
const STORE_KINDS = ['ios_app', 'android_app', 'search_console_site'] as const

/** The page where the account behind each kind is set up. */
const SETUP_PAGE = {
  ios_app: '/settings/integrations/app-store',
  android_app: '/settings/integrations/google-play',
  search_console_site: '/settings/integrations/search-console',
} as const

/** A select's value for "nothing chosen"; Radix keeps the empty string for its placeholder. */
const NONE = 'none'

const ROW = 'flex flex-wrap gap-x-8 gap-y-3 px-5 py-4'
const ROW_LABEL = 'w-full pt-1.5 text-sm font-medium sm:w-56 sm:shrink-0'
const ROW_BODY = 'w-full min-w-0 space-y-3 sm:w-auto sm:flex-1'

/** Where an asset belongs now, said next to it in a list of choices. */
function whereNow(asset: Asset, appOf: (appId: string) => AppSummary | undefined): ReactNode {
  if (asset.appId === null) return ''
  const other = appOf(asset.appId)
  if (other?.kind === 'portfolio') return ' (in Shared accounts)'
  return (
    <>
      {' (now in '}
      <Private>{other?.name ?? 'another app'}</Private>)
    </>
  )
}

function SlotRow(props: {
  kind: (typeof STORE_KINDS)[number]
  appId: string
  current: Asset | undefined
  candidates: Asset[]
  appOf: (appId: string) => AppSummary | undefined
  actions: AssetActions
}) {
  const { kind, appId, current, candidates, appOf, actions } = props
  const selectId = useId()
  const label = KIND_LABEL[kind] ?? kind

  return (
    <li className={ROW}>
      <Label htmlFor={selectId} className={ROW_LABEL}>
        {label}
      </Label>
      <div className={ROW_BODY}>
        {candidates.length === 0 ? (
          <p className="pt-1.5 text-muted-foreground">
            None found.{' '}
            <Link to={SETUP_PAGE[kind]} className="font-medium text-foreground underline underline-offset-4">
              Connect {SOURCE_OF_KIND[kind]}
            </Link>{' '}
            to find one.
          </p>
        ) : (
          <>
            <Select
              value={current?.id ?? NONE}
              disabled={actions.pending}
              onValueChange={(chosen) => {
                if (chosen === NONE) {
                  if (current) actions.assign(current.id, null)
                } else {
                  actions.assign(chosen, appId)
                }
              }}
            >
              <SelectTrigger id={selectId} className="w-full max-w-md">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>None</SelectItem>
                {candidates.map((asset) => {
                  const detail = assetDetail(asset)
                  return (
                    <SelectItem key={asset.id} value={asset.id}>
                      <Private>
                        {asset.name}
                        {detail ? ` · ${detail}` : ''}
                      </Private>
                      {asset.appId === appId ? '' : whereNow(asset, appOf)}
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
            {current && ATTENTION[current.status] && (
              <p className="text-xs font-medium text-warning">
                The account behind it {ATTENTION[current.status]}.{' '}
                <Link to={SETUP_PAGE[kind]} className="underline underline-offset-4">
                  Connect it again
                </Link>
              </p>
            )}
          </>
        )}
      </div>
    </li>
  )
}

function SocialRow(props: {
  appId: string
  linked: Asset[]
  candidates: Asset[]
  appOf: (appId: string) => AppSummary | undefined
  actions: AssetActions
}) {
  const { appId, linked, candidates, appOf, actions } = props
  const [adding, setAdding] = useState('')
  const selectId = useId()

  return (
    <li className={ROW}>
      <span className={ROW_LABEL}>Social accounts</span>
      <div className={ROW_BODY}>
        {linked.length > 0 ? (
          <ul className="divide-y rounded-lg border">
            {linked.map((asset) => (
              <li key={asset.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-2">
                <span className="min-w-0 break-words">
                  <SourceLogo source={LOGO_OF_KIND[asset.kind] ?? asset.kind} className="mr-1.5 text-muted-foreground" />
                  <Private>{asset.name}</Private>
                  {ATTENTION[asset.status] && (
                    <span className="block text-xs font-medium text-warning">The account {ATTENTION[asset.status]}.</span>
                  )}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
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
          <p className="pt-1.5 text-muted-foreground">None yet.</p>
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
            <Label htmlFor={selectId} className="sr-only">
              Social account to add
            </Label>
            <Select value={adding} onValueChange={setAdding}>
              <SelectTrigger id={selectId} className="min-w-0 flex-1">
                <SelectValue placeholder="Add a social account" />
              </SelectTrigger>
              <SelectContent>
                {candidates.map((asset) => (
                  <SelectItem key={asset.id} value={asset.id}>
                    <SourceLogo source={LOGO_OF_KIND[asset.kind] ?? asset.kind} className="text-muted-foreground" />
                    <Private>{asset.name}</Private>
                    {whereNow(asset, appOf)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="submit" variant="outline" disabled={!adding || actions.pending}>
              Add
            </Button>
          </form>
        ) : (
          <p className="text-xs text-muted-foreground">
            To add more,{' '}
            <Link to="/settings/integrations" className="font-medium text-foreground underline underline-offset-4">
              connect Facebook, Instagram, TikTok or YouTube
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
  appOf: (appId: string) => AppSummary | undefined
  actions: AssetActions
}) {
  const { app, current, others, appOf, actions } = props
  const [replacing, setReplacing] = useState(false)
  const [choice, setChoice] = useState('')
  const selectId = useId()

  return (
    <li className={ROW}>
      <span className={ROW_LABEL}>RevenueCat project</span>
      <div className={ROW_BODY}>
        {current && (
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border px-3 py-2">
            <span className="min-w-0 break-words">
              <Private>{current.name}</Private>
              <span className="block text-xs text-muted-foreground">
                <Private>{current.bundleId ?? current.externalId}</Private>
                {ATTENTION[current.status] && (
                  <span className="font-medium text-warning"> · The key {ATTENTION[current.status]}; replace it.</span>
                )}
              </span>
            </span>
            {!replacing && (
              <span className="flex gap-1">
                <Button variant="ghost" size="sm" onClick={() => setReplacing(true)}>
                  Replace key
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
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
            onConnected={() => setReplacing(false)}
          />
        )}
        {!current && others.length > 0 && (
          <div className="flex flex-wrap gap-2 border-t pt-3">
            <Label htmlFor={selectId} className="w-full text-xs font-normal text-muted-foreground">
              Or use a project that is already connected
            </Label>
            <Select value={choice} onValueChange={setChoice}>
              <SelectTrigger id={selectId} className="min-w-0 flex-1">
                <SelectValue placeholder="Choose a project" />
              </SelectTrigger>
              <SelectContent>
                {others.map((asset) => (
                  <SelectItem key={asset.id} value={asset.id}>
                    <Private>{asset.name}</Private>
                    {whereNow(asset, appOf)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" disabled={!choice || actions.pending} onClick={() => actions.assign(choice, app.id)}>
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
  onConnected: () => void
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
      toast.success(
        project ? (
          <span>
            Connected <Private>{project.name}</Private>.
            {project.movedFrom && (
              <>
                {' It fed '}
                <Private>{project.movedFrom}</Private> until now.
              </>
            )}
            {project.replaced && (
              <>
                {' '}
                <Private>{project.replaced}</Private> now waits on the Apps page.
              </>
            )}{' '}
            Its history is being fetched; the numbers appear within a minute.
          </span>
        ) : (
          'Connected.'
        ),
        { duration: 8000 },
      )
      props.onConnected()
      await queryClient.invalidateQueries()
    },
  })
  const result = mutation.data

  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault()
        mutation.mutate()
      }}
    >
      <p className="text-xs text-muted-foreground">
        In RevenueCat, open the project for <Private>{props.app.name}</Private>, then Project settings, API keys.
        Create a secret API key, version 2, with read access to Charts &amp; metrics and to Project
        configuration, and paste it here. It is stored encrypted and never shown again.
      </p>
      <div className="flex flex-wrap gap-2">
        <Label htmlFor={inputId} className="sr-only">
          RevenueCat secret key for {props.app.name}
        </Label>
        <Input
          id={inputId}
          type="password"
          autoComplete="off"
          required
          minLength={8}
          placeholder="sk_…"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          className="min-w-0 flex-1 basis-48"
        />
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending && <Spinner />}
          {mutation.isPending ? 'Connecting…' : props.replacing ? 'Replace key' : 'Connect'}
        </Button>
        {props.replacing && (
          <Button variant="outline" disabled={mutation.isPending} onClick={props.onCancel}>
            Cancel
          </Button>
        )}
      </div>
      <p role="status" className="text-sm text-destructive empty:hidden">
        {mutation.isError && 'Could not reach the dashboard server. Try again.'}
        {result && !result.ok && result.message}
      </p>
    </form>
  )
}
