import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { Link, createFileRoute, useNavigate, useRouterState } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { useId, useState, type ReactNode } from 'react'
import { Button } from '../../components/Button'
import { useAssetActions, type AssetActions } from '../../components/useAssetActions'
import { createAppFn } from '../../fns/assets'
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
  // Set by the app page after removing an app; history state, so a link cannot set it.
  const removedApp = useRouterState({ select: (state) => state.location.state.removedApp })

  const waiting = assets.filter((asset) => asset.appId === null && !asset.ignored)
  const ignored = assets.filter((asset) => asset.ignored)
  const ownApps = apps.filter((app) => app.kind !== 'portfolio')

  return (
    <>
      <h1 className="font-display text-3xl font-semibold tracking-tight">Apps</h1>
      <p className="mt-2 max-w-prose text-ink-soft">
        An app gathers its iOS and Android apps, its RevenueCat project and the social accounts that
        promote it. The accounts you sign in to on the{' '}
        <Link to="/accounts" className="font-medium text-ink underline underline-offset-4">
          Accounts page
        </Link>{' '}
        find these, and nothing becomes an app until you add it. Once an app is here, what clearly
        belongs to it joins by itself, like an Android package equal to its iOS bundle id.
      </p>

      {removedApp && !actions.notice && (
        <p role="status" className="mt-6 max-w-3xl rounded-lg border border-line bg-surface px-6 py-4 text-sm">
          Removed {removedApp}. What fed it waits below, to add again or ignore.
        </p>
      )}

      {actions.notice && (
        <p
          role="status"
          className={`mt-6 max-w-3xl rounded-lg border bg-surface px-6 py-4 text-sm ${
            actions.notice.ok ? 'border-line' : 'border-ink'
          }`}
        >
          {actions.notice.message}
        </p>
      )}

      {waiting.length > 0 && (
        <Section
          title="Needs a decision"
          intro="Found by your accounts, not tracked yet. Add the ones you want as apps, link them to an app, or ignore them. A suggestion comes from a matching name; check it before linking."
          action={
            waiting.length > 1 && (
              <Button
                disabled={actions.pending}
                onClick={() => actions.ignore(waiting.map((asset) => asset.id), true)}
              >
                Ignore all {waiting.length}
              </Button>
            )
          }
        >
          <ul className="max-w-3xl divide-y divide-line rounded-lg border border-line bg-surface text-sm">
            {waiting.map((asset) => (
              <Decision key={asset.id} asset={asset} apps={ownApps} actions={actions} />
            ))}
          </ul>
        </Section>
      )}

      <Section title="All apps">
        <AppsOverview apps={apps} assets={assets} />
      </Section>

      <Section
        title="Add an app"
        intro="For an app that is only on Android, or one whose store listing does not exist yet. Its page lets you pick what feeds it."
      >
        <NewApp />
      </Section>

      {ignored.length > 0 && (
        <Section title="Ignored" intro="Found by an account, but not tracked: old apps, test projects, personal accounts.">
          <ul className="max-w-3xl divide-y divide-line rounded-lg border border-line bg-surface text-sm">
            {ignored.map((asset) => (
              <li key={asset.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-6 py-3">
                <AssetName asset={asset} />
                <Button disabled={actions.pending} onClick={() => actions.ignore([asset.id], false)}>
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  )
}

function Section(props: { title: string; intro?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-12">
      <div className="flex max-w-3xl flex-wrap items-end justify-between gap-3">
        <h2 className="font-display text-xl font-semibold tracking-tight">{props.title}</h2>
        {props.action}
      </div>
      {props.intro && <p className="mt-2 max-w-prose text-sm text-ink-soft">{props.intro}</p>}
      <div className="mt-4">{props.children}</div>
    </section>
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
    <li className="grid gap-3 px-6 py-4 sm:grid-cols-[minmax(0,1fr)_16rem_auto] sm:items-center">
      <div className="min-w-0">
        <AssetName asset={asset} />
        {suggested && <span className="mt-1 block text-xs">Looks like {suggested.name}</span>}
      </div>
      <label htmlFor={selectId} className="sr-only">
        App for {asset.name}
      </label>
      <select
        id={selectId}
        value={choice}
        onChange={(event) => setChoice(event.target.value)}
        className="w-full min-w-0 rounded-md border border-line bg-surface px-3 py-2"
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
          disabled={!choice || actions.pending}
          onClick={() => actions.assign(asset.id, choice)}
        >
          {choice === 'new' ? 'Add app' : 'Link'}
        </Button>
        <Button disabled={actions.pending} onClick={() => actions.ignore([asset.id], true)}>
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
      <p className="rounded-lg border border-line bg-surface px-6 py-5 text-sm text-ink-soft">
        No apps yet. Connect a source on the Accounts page, then add the apps you want to track
        from what it finds, or add one by name below.
      </p>
    )
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full min-w-[680px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-line text-left text-ink-soft">
            <th scope="col" className="px-4 py-3 font-medium">
              App
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              iOS
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Android
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Revenue
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Social
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
              <tr key={app.id} className="border-b border-line align-top last:border-b-0">
                <th scope="row" className="px-4 py-4 text-left font-medium">
                  <Link
                    to="/apps/$appId"
                    params={{ appId: app.id }}
                    search={{ range: '28d' }}
                    className="underline decoration-line underline-offset-4 hover:decoration-ink"
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
                  <td colSpan={3} className="px-4 py-4 text-ink-soft">
                    Social accounts only
                  </td>
                ) : (
                  <>
                    <SlotCell asset={one('ios_app')} detail={(asset) => asset.bundleId ?? asset.name} />
                    <SlotCell asset={one('android_app')} detail={(asset) => asset.externalId} />
                    <SlotCell asset={one('revenuecat_project')} detail={(asset) => asset.name} />
                  </>
                )}
                <td className="px-4 py-4">
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
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function SlotCell(props: { asset: Asset | undefined; detail: (asset: Asset) => string }) {
  return (
    <td className="px-4 py-4 break-words">
      {props.asset ? (
        <>
          {props.detail(props.asset)}
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

function NewApp() {
  const create = useServerFn(createAppFn)
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const mutation = useMutation({
    mutationFn: (appName: string) => create({ data: { name: appName } }),
    onSuccess: async (result) => {
      if (!result.ok) return
      await queryClient.invalidateQueries()
      await navigate({ to: '/apps/$appId', params: { appId: result.appId }, search: { range: '28d' }, hash: 'sources' })
    },
  })
  const result = mutation.data

  return (
    <form
      className="max-w-3xl"
      onSubmit={(event) => {
        event.preventDefault()
        mutation.mutate(name)
      }}
    >
      <label htmlFor="new-app-name" className="text-sm font-medium">
        App name
      </label>
      <div className="mt-2 flex flex-wrap gap-3">
        <input
          id="new-app-name"
          name="new-app-name"
          required
          maxLength={80}
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="min-w-0 flex-1 rounded-md border border-line bg-surface px-3 py-2"
        />
        <Button type="submit" variant="primary" disabled={mutation.isPending}>
          {mutation.isPending ? 'Adding…' : 'Add app'}
        </Button>
      </div>
      <div role="status" className="mt-3 text-sm">
        {mutation.isError && 'Could not reach the dashboard server. Try again.'}
        {result && !result.ok && result.message}
      </div>
    </form>
  )
}
