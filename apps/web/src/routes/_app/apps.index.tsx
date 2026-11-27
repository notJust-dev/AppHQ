import { useSuspenseQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { Plus, Settings } from 'lucide-react'
import { useId, useState } from 'react'
import { AppIcon } from '@/components/AppIcon'
import { NoData } from '@/components/NoData'
import { PageBody, PageHeader } from '@/components/PageHeader'
import { Private } from '@/components/Private'
import { SourceLogo } from '@/components/SourceLogo'
import { Panel } from '@/components/Panel'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableRowHead,
} from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useAssetActions, type AssetActions } from '@/components/useAssetActions'
import {
  ATTENTION,
  KIND_LABEL,
  LOGO_OF_KIND,
  PORTFOLIO_APP_ID,
  assetDetail,
} from '@/lib/assets'
import { appsQuery, assetsQuery, type AppSummary, type Asset } from '@/lib/queries'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_app/apps/')({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(appsQuery()),
      context.queryClient.ensureQueryData(assetsQuery()),
    ]),
  component: AppsPage,
})

/**
 * Each app with what feeds it, and what the accounts found that belongs to no app yet. Links
 * settle themselves only on exact evidence; everything else is a decision made here.
 */
function AppsPage() {
  const { data: apps } = useSuspenseQuery(appsQuery())
  const { data: assets } = useSuspenseQuery(assetsQuery())
  const actions = useAssetActions()

  const waiting = assets.filter((asset) => asset.appId === null && !asset.ignored)
  const ignored = assets.filter((asset) => asset.ignored)
  const ownApps = apps.filter((app) => app.kind !== 'portfolio')

  return (
    <>
      <PageHeader
        title="Apps"
        description={
          <>
            An app gathers its iOS and Android apps, its RevenueCat project and the social accounts
            that promote it. Your{' '}
            <Link to="/accounts" className="font-medium text-foreground underline underline-offset-4">
              accounts
            </Link>{' '}
            find these; nothing becomes an app until you add it.
          </>
        }
        actions={
          <Button asChild>
            <Link to="/apps/new">
              <Plus aria-hidden="true" />
              Add app
            </Link>
          </Button>
        }
      />
      <PageBody>
        {waiting.length > 0 && (
          <Panel
            title={
              <span className="flex items-center gap-2">
                Needs a decision
                <Badge variant="warning">{waiting.length}</Badge>
              </span>
            }
            description="Found by your accounts, not tracked yet. Add the ones you want as apps, link them to an app, or ignore them. A suggestion comes from a matching name; check it before linking."
            actions={
              waiting.length > 1 && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={actions.pending}
                  onClick={() => actions.ignore(waiting.map((asset) => asset.id), true)}
                >
                  Ignore all {waiting.length}
                </Button>
              )
            }
            bodyClassName=""
          >
            <ul className="divide-y">
              {waiting.map((asset) => (
                <Decision key={asset.id} asset={asset} apps={ownApps} actions={actions} />
              ))}
            </ul>
          </Panel>
        )}

        <Panel title="All apps" description="What feeds each app. Once an app is here, what clearly belongs to it joins by itself, like an Android package equal to its iOS bundle id." bodyClassName="">
          <AppsOverview apps={apps} assets={assets} />
        </Panel>

        {ignored.length > 0 && (
          <Panel
            title="Ignored"
            description="Found by an account, but not tracked: old apps, test projects, personal accounts."
            bodyClassName=""
          >
            <ul className="divide-y">
              {ignored.map((asset) => (
                <li key={asset.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3">
                  <AssetName asset={asset} />
                  <Button variant="outline" size="sm" disabled={actions.pending} onClick={() => actions.ignore([asset.id], false)}>
                    Restore
                  </Button>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </PageBody>
    </>
  )
}

/** The name of an asset, with what kind it is and what tells it apart. */
function AssetName({ asset }: { asset: Asset }) {
  const detail = assetDetail(asset)
  return (
    <span className="flex min-w-0 items-center gap-3">
      {/* Store apps whose account gave an icon; it helps tell an app from its old twin. */}
      {asset.iconUrl && <AppIcon app={asset} className="size-8 text-xs" />}
      <span className="min-w-0">
        <Private className="block font-medium break-words">{asset.name}</Private>
        <span className="block text-xs text-muted-foreground">
          {KIND_LABEL[asset.kind] ?? asset.label}
          {detail && (
            <>
              {' · '}
              <Private>{detail}</Private>
            </>
          )}
          {asset.account && asset.account !== asset.name && (
            <>
              {' · via '}
              <Private>{asset.account}</Private>
            </>
          )}
        </span>
      </span>
    </span>
  )
}

/** One asset without an app: add it as an app, link it to one or to Shared accounts, or ignore it. */
function Decision(props: { asset: Asset; apps: AppSummary[]; actions: AssetActions }) {
  const { asset, apps, actions } = props
  // A store app or project with no likely app is most often one to add.
  const [choice, setChoice] = useState(asset.suggestedAppId ?? (asset.social ? '' : 'new'))
  const selectId = useId()
  const suggested = apps.find((app) => app.id === asset.suggestedAppId)
  const label = KIND_LABEL[asset.kind] ?? asset.label
  // An app holds one of each store app and one RevenueCat project; linking replaces it.
  const holder = (app: AppSummary) =>
    asset.social ? undefined : app.assets.find((other) => other.kind === asset.kind)

  return (
    <li className="grid gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_16rem_auto] sm:items-center">
      <div className="min-w-0">
        <AssetName asset={asset} />
        {suggested && (
          // Under the name, past the icon when there is one.
          <span className={cn('mt-1 block text-xs text-foreground', asset.iconUrl && 'pl-11')}>
            Looks like <Private>{suggested.name}</Private>
          </span>
        )}
      </div>
      <Label htmlFor={selectId} className="sr-only">
        App for {asset.name}
      </Label>
      <Select value={choice} onValueChange={setChoice}>
        <SelectTrigger id={selectId} className="w-full min-w-0">
          <SelectValue placeholder="Choose an app" />
        </SelectTrigger>
        <SelectContent>
          {!asset.social && <SelectItem value="new">Add as a new app</SelectItem>}
          {apps.map((app) => {
            const current = holder(app)
            return (
              <SelectItem key={app.id} value={app.id}>
                <Private>{app.name}</Private>
                {current ? ` (replaces its ${label})` : ''}
              </SelectItem>
            )
          })}
          {asset.social && <SelectItem value={PORTFOLIO_APP_ID}>Shared accounts (promotes several apps)</SelectItem>}
        </SelectContent>
      </Select>
      <div className="flex gap-2">
        <Button size="sm" disabled={!choice || actions.pending} onClick={() => actions.assign(asset.id, choice)}>
          {choice === 'new' ? 'Add app' : 'Link'}
        </Button>
        <Button variant="outline" size="sm" disabled={actions.pending} onClick={() => actions.ignore([asset.id], true)}>
          Ignore
        </Button>
      </div>
    </li>
  )
}

/** Every app, and the shared accounts, with what feeds each one. */
function AppsOverview({ apps, assets }: { apps: AppSummary[]; assets: Asset[] }) {
  const of = (appId: string) => assets.filter((asset) => asset.appId === appId)
  // Shared accounts only earn a row once something belongs to them.
  const rows = apps.filter((app) => app.kind !== 'portfolio' || of(app.id).length > 0)

  if (rows.length === 0) {
    return (
      <p className="px-5 py-6 text-muted-foreground">
        No apps yet. Connect a source on the Accounts page, then add the apps you want to track
        from what it finds, or add one by name with Add app.
      </p>
    )
  }

  return (
    <Table className="min-w-[700px]">
      <TableHeader>
        <TableRow>
          <TableHead scope="col">App</TableHead>
          <TableHead scope="col">Stores</TableHead>
          <TableHead scope="col">Revenue</TableHead>
          <TableHead scope="col">Website</TableHead>
          <TableHead scope="col">Social</TableHead>
          <TableHead scope="col">
            <span className="sr-only">Settings</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((app) => {
          const mine = of(app.id)
          const one = (kind: string) => mine.find((asset) => asset.kind === kind)
          const social = mine.filter((asset) => asset.social)
          const portfolio = app.kind === 'portfolio'
          return (
            <TableRow key={app.id} className="align-top">
              <TableRowHead className="align-top">
                <span className="flex items-start gap-2.5">
                  {!portfolio && <AppIcon app={app} className="size-6 text-[11px]" />}
                  <span className="min-w-0 pt-0.5">
                    <Link
                      to="/apps/$appId"
                      params={{ appId: app.id }}
                      className="hover:underline hover:underline-offset-4"
                    >
                      {portfolio ? app.name : <Private>{app.name}</Private>}
                    </Link>
                    {portfolio && (
                      <span className="mt-1 block text-xs font-normal text-muted-foreground">
                        Accounts that promote several apps
                      </span>
                    )}
                  </span>
                </span>
              </TableRowHead>
              {portfolio ? (
                <TableCell colSpan={3} className="align-top text-muted-foreground">
                  Social accounts only
                </TableCell>
              ) : (
                <>
                  <StoresCell ios={one('ios_app')} android={one('android_app')} />
                  <SlotCell asset={one('revenuecat_project')} detail={(asset) => asset.name} />
                  <SlotCell asset={one('search_console_site')} detail={(asset) => asset.name} />
                </>
              )}
              <TableCell className="align-top">
                {social.length === 0 ? (
                  <None />
                ) : (
                  <ul className="space-y-1">
                    {social.map((asset) => (
                      <li key={asset.id}>
                        {/* The logo stays on the handle's line. */}
                        <span className="whitespace-nowrap">
                          <SourceLogo source={LOGO_OF_KIND[asset.kind] ?? asset.kind} className="mr-1.5 text-muted-foreground" />
                          <Private>{asset.name}</Private>
                        </span>
                        <Attention status={asset.status} />
                      </li>
                    ))}
                  </ul>
                )}
              </TableCell>
              <TableCell className="text-right align-top">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button asChild variant="ghost" size="icon-sm" className="-my-1 text-muted-foreground">
                      <Link
                        to="/apps/$appId/settings"
                        params={{ appId: app.id }}
                        aria-label={`Settings for ${app.name}`}
                      >
                        <Settings />
                      </Link>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Settings</TooltipContent>
                </Tooltip>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

/** Which stores the app is in, as their logos; the bundle id and package are on its settings. */
function StoresCell({ ios, android }: { ios: Asset | undefined; android: Asset | undefined }) {
  const stores = [
    { source: 'app_store', asset: ios },
    { source: 'google_play', asset: android },
  ].filter((store): store is { source: string; asset: Asset } => store.asset !== undefined)

  return (
    <TableCell className="align-top">
      {stores.length === 0 ? (
        <None />
      ) : (
        <>
          <span className="flex items-center gap-2.5 pt-0.5">
            {stores.map((store) => (
              <SourceLogo key={store.source} source={store.source} className="size-[18px]" />
            ))}
          </span>
          {stores.map((store) => (
            <Attention key={store.source} status={store.asset.status} />
          ))}
        </>
      )}
    </TableCell>
  )
}

function SlotCell(props: { asset: Asset | undefined; detail: (asset: Asset) => string }) {
  return (
    <TableCell className="align-top break-words">
      {props.asset ? (
        <>
          <Private>{props.detail(props.asset)}</Private>
          <Attention status={props.asset.status} />
        </>
      ) : (
        <None />
      )}
    </TableCell>
  )
}

function None() {
  return (
    <span className="text-faint">
      <NoData label="None" />
    </span>
  )
}

/** Says so when the account behind an asset needs the person. */
function Attention({ status }: { status: string }) {
  const note = ATTENTION[status]
  if (!note) return null
  return <span className="block text-xs font-medium text-warning">Account {note}</span>
}
