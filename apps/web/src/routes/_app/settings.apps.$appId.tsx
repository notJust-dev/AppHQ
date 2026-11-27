import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { Link, createFileRoute, notFound } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { ChartLine } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { AppIcon } from '@/components/AppIcon'
import { AppSources } from '@/components/AppSources'
import { Panel, SettingRow } from '@/components/Panel'
import { RemoveApp } from '@/components/RemoveApp'
import { SettingsPage } from '@/components/SettingsPage'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { renameAppFn } from '@/fns/assets'
import { appsQuery, assetsQuery } from '@/lib/queries'

/** What belongs to one app: its name, what feeds it, and whether it is tracked at all. */
export const Route = createFileRoute('/_app/settings/apps/$appId')({
  loader: async ({ context, params }) => {
    const known = (list: { id: string }[]) => list.some((app) => app.id === params.appId)
    // The list may be cached from before the app was added, so ask again before giving up.
    const found =
      known(await context.queryClient.ensureQueryData(appsQuery())) ||
      known(await context.queryClient.fetchQuery({ ...appsQuery(), staleTime: 0 }))
    if (!found) throw notFound()
    await context.queryClient.ensureQueryData(assetsQuery())
  },
  component: AppSettings,
  notFoundComponent: AppNotFound,
})

function AppSettings() {
  const { appId } = Route.useParams()
  const { data: apps } = useSuspenseQuery(appsQuery())
  const { data: assets } = useSuspenseQuery(assetsQuery())
  const app = apps.find((entry) => entry.id === appId)
  // Gone for a moment after it is removed, while the page moves on to the Apps list.
  if (!app) return null
  const portfolio = app.kind === 'portfolio'

  return (
    <SettingsPage
      crumbs={[{ label: 'Apps', to: '/settings/apps' }]}
      title={app.name}
      privateTitle={!portfolio}
      icon={portfolio ? undefined : <AppIcon app={app} className="size-9 text-sm" />}
      actions={
        // Settings link to settings; the numbers are on Overview, with this app chosen.
        <Button asChild variant="outline" size="sm">
          <Link to="/" search={(previous) => ({ ...previous, app: app.id })}>
            <ChartLine aria-hidden="true" />
            View numbers
          </Link>
        </Button>
      }
    >
      {!portfolio && <Rename appId={app.id} name={app.name} />}
      <AppSources app={app} apps={apps} assets={assets} />
      {!portfolio && <RemoveApp appId={app.id} name={app.name} />}
    </SettingsPage>
  )
}

function AppNotFound() {
  return (
    <SettingsPage crumbs={[{ label: 'Apps', to: '/settings/apps' }]} title="There is no such app">
      <p className="text-muted-foreground">
        It may have been removed, or the address may be mistyped.{' '}
        <Link to="/settings/apps" className="font-medium text-foreground underline underline-offset-4">
          Go to the apps
        </Link>
      </p>
    </SettingsPage>
  )
}

function Rename(props: { appId: string; name: string }) {
  const rename = useServerFn(renameAppFn)
  const queryClient = useQueryClient()
  const [name, setName] = useState(props.name)
  const mutation = useMutation({
    mutationFn: () => rename({ data: { appId: props.appId, name } }),
    onSuccess: async (result) => {
      if (!result.ok) return
      toast.success('Name saved.')
      await queryClient.invalidateQueries()
    },
  })
  const result = mutation.data
  const unchanged = name.trim() === props.name

  return (
    <Panel title="General" bodyClassName="">
      <SettingRow label="Name" description="How the app is called across the dashboard. Its address stays the same." htmlFor="app-name">
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (!unchanged) mutation.mutate()
          }}
        >
          <Input
            id="app-name"
            required
            maxLength={80}
            value={name}
            data-private=""
            onChange={(event) => setName(event.target.value)}
            className="min-w-0 flex-1 basis-48"
          />
          <Button type="submit" variant="outline" disabled={mutation.isPending || unchanged}>
            {mutation.isPending && <Spinner />}
            {mutation.isPending ? 'Saving…' : 'Save name'}
          </Button>
        </form>
        <p role="status" className="mt-2 text-sm text-destructive empty:hidden">
          {mutation.isError && 'Could not reach the dashboard server. Try again.'}
          {result && !result.ok && result.message}
        </p>
      </SettingRow>
    </Panel>
  )
}
