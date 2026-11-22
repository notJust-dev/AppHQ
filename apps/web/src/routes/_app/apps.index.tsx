import { useSuspenseQuery } from '@tanstack/react-query'
import { Link, createFileRoute, useNavigate, useRouterState } from '@tanstack/react-router'
import { useEffect, useId, useState } from 'react'
import { Plus } from 'lucide-react'
import { Button, buttonClass } from '../../components/Button'
import { Notice } from '../../components/ui/Notice'
import { PageBody, PageHeader } from '../../components/ui/PageHeader'
import { Panel } from '../../components/ui/Panel'
import { TABLE, TD, TH, THEAD_ROW, TR } from '../../components/ui/table'
import { useAssetActions, type AssetActions } from '../../components/useAssetActions'
import {
  ATTENTION,
  KIND_LABEL,
  PLATFORM_OF_KIND,
  PORTFOLIO_APP_ID,
  assetDetail,
} from '../../lib/assets'
import { appsQuery, assetsQuery, type AppSummary, type Asset } from '../../lib/queries'

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
  // Set by the app page after removing an app; history state, so a link cannot set it. Read
  // after hydration (the server never sees history state), then cleared so a reload does not
  // repeat it.
  const removedState = useRouterState({ select: (state) => state.location.state.removedApp })
  const navigate = useNavigate()
  const [removedApp, setRemovedApp] = useState<string | null>(null)
  useEffect(() => {
    if (!removedState) return
    setRemovedApp(removedState)
    void navigate({ to: '/apps', replace: true, state: {} })
  }, [removedState, navigate])

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
            <Link to="/accounts" className="font-medium text-ink underline underline-offset-4">
              accounts
            </Link>{' '}
            find these; nothing becomes an app until you add it.
          </>
        }
        actions={
          <Link to="/apps/new" className={buttonClass('primary')}>
            <Plus className="size-4" aria-hidden="true" />
            Add app
          </Link>
        }
      />
      <PageBody>
        {removedApp && !actions.notice && (
          <Notice>Removed {removedApp}. What fed it waits below, to add again or ignore.</Notice>
        )}
        {actions.notice && <Notice ok={actions.notice.ok}>{actions.notice.message}</Notice>}

        {waiting.length > 0 && (
          <Panel
            title="Needs a decision"
            description="Found by your accounts, not tracked yet. Add the ones you want as apps, link them to an app, or ignore them. A suggestion comes from a matching name; check it before linking."
            actions={
              waiting.length > 1 && (
                <Button
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
            <ul className="divide-y divide-line">
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
            <ul className="divide-y divide-line">
              {ignored.map((asset) => (
                <li key={asset.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3">
                  <AssetName asset={asset} />
                  <Button size="sm" disabled={actions.pending} onClick={() => actions.ignore([asset.id], false)}>
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
    <span className="min-w-0">
      <span className="block font-medium break-words">{asset.name}</span>
      <span className="block text-xs text-ink-soft">
        {KIND_LABEL[asset.kind] ?? asset.label}
        {detail && <> · {detail}</>}
        {asset.account && asset.account !== asset.name && <> · via {asset.account}</>}
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
        {suggested && <span className="mt-1 block text-xs text-ink">Looks like {suggested.name}</span>}
      </div>
      <label htmlFor={selectId} className="sr-only">
        App for {asset.name}
      </label>
      <select
        id={selectId}
        value={choice}
        onChange={(event) => setChoice(event.target.value)}
        className="w-full min-w-0 field"
      >
        <option value="" disabled>
          Choose an app
        </option>
        {!asset.social && <option value="new">Add as a new app</option>}
        {apps.map((app) => {
          const current = holder(app)
          return (
            <option key={app.id} value={app.id}>
              {app.name}
              {current ? ` (replaces its ${label})` : ''}
            </option>
          )
        })}
        {asset.social && <option value={PORTFOLIO_APP_ID}>Shared accounts (promotes several apps)</option>}
      </select>
      <div className="flex gap-2">
        <Button
          variant="primary"
          size="sm"
          disabled={!choice || actions.pending}
          onClick={() => actions.assign(asset.id, choice)}
        >
          {choice === 'new' ? 'Add app' : 'Link'}
        </Button>
        <Button size="sm" disabled={actions.pending} onClick={() => actions.ignore([asset.id], true)}>
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
      <p className="px-5 py-6 text-ink-soft">
        No apps yet. Connect a source on the Accounts page, then add the apps you want to track
        from what it finds, or add one by name with Add app.
      </p>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className={`${TABLE} min-w-[680px]`}>
        <thead>
          <tr className={THEAD_ROW}>
            <th scope="col" className={TH}>
              App
            </th>
            <th scope="col" className={TH}>
              iOS
            </th>
            <th scope="col" className={TH}>
              Android
            </th>
            <th scope="col" className={TH}>
              Revenue
            </th>
            <th scope="col" className={TH}>
              Social
            </th>
            <th scope="col" className={TH}>
              <span className="sr-only">Settings</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((app) => {
            const mine = of(app.id)
            const one = (kind: string) => mine.find((asset) => asset.kind === kind)
            const social = mine.filter((asset) => asset.social)
            const portfolio = app.kind === 'portfolio'
            return (
              <tr key={app.id} className={TR}>
                <th scope="row" className={`${TD} text-left font-medium`}>
                  <Link
                    to="/apps/$appId"
                    params={{ appId: app.id }}
                    search={{ range: '28d' }}
                    className="hover:underline hover:underline-offset-4"
                  >
                    {app.name}
                  </Link>
                  {portfolio && (
                    <span className="mt-1 block text-xs font-normal text-ink-soft">
                      Accounts that promote several apps
                    </span>
                  )}
                </th>
                {portfolio ? (
                  <td colSpan={3} className={`${TD} text-ink-soft`}>
                    Social accounts only
                  </td>
                ) : (
                  <>
                    <SlotCell asset={one('ios_app')} detail={(asset) => asset.bundleId ?? asset.name} mono />
                    <SlotCell asset={one('android_app')} detail={(asset) => asset.externalId} mono />
                    <SlotCell asset={one('revenuecat_project')} detail={(asset) => asset.name} />
                  </>
                )}
                <td className={TD}>
                  {social.length === 0 ? (
                    <None />
                  ) : (
                    <ul className="space-y-1">
                      {social.map((asset) => (
                        <li key={asset.id}>
                          <span className="text-ink-soft">{PLATFORM_OF_KIND[asset.kind]}</span>{' '}
                          <span className="whitespace-nowrap">{asset.name}</span>
                          <Attention status={asset.status} />
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
                <td className={`${TD} text-right`}>
                  <Link
                    to="/apps/$appId/settings"
                    params={{ appId: app.id }}
                    search={{ range: '28d' }}
                    aria-label={`Settings for ${app.name}`}
                    className="font-medium text-ink-soft underline decoration-line underline-offset-4 hover:text-ink"
                  >
                    Settings
                  </Link>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function SlotCell(props: { asset: Asset | undefined; detail: (asset: Asset) => string; mono?: boolean }) {
  return (
    <td className={`${TD} break-words`}>
      {props.asset ? (
        <>
          <span className={props.mono ? 'font-mono text-xs' : undefined}>{props.detail(props.asset)}</span>
          <Attention status={props.asset.status} />
        </>
      ) : (
        <None />
      )}
    </td>
  )
}

function None() {
  return (
    <span className="text-ink-soft">
      <span aria-hidden="true">–</span>
      <span className="sr-only">None</span>
    </span>
  )
}

/** Says so when the account behind an asset needs the person. */
function Attention({ status }: { status: string }) {
  const note = ATTENTION[status]
  if (!note) return null
  return <span className="block text-xs font-medium">Account {note}</span>
}
