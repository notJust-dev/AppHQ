import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { AppSources } from '../../components/AppSources'
import { Button } from '../../components/Button'
import { Panel, SettingRow } from '../../components/ui/Panel'
import { RemoveApp } from '../../components/RemoveApp'
import { renameAppFn } from '../../fns/assets'
import { appsQuery, assetsQuery } from '../../lib/queries'

/** What belongs to one app: its name, what feeds it, and whether it is tracked at all. */
export const Route = createFileRoute('/_app/apps/$appId/settings')({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(appsQuery()),
      context.queryClient.ensureQueryData(assetsQuery()),
    ]),
  component: AppSettings,
})

function AppSettings() {
  const { appId } = Route.useParams()
  const { data: apps } = useSuspenseQuery(appsQuery())
  const { data: assets } = useSuspenseQuery(assetsQuery())
  const app = apps.find((entry) => entry.id === appId)
  if (!app) return null
  const portfolio = app.kind === 'portfolio'

  return (
    <div className="max-w-4xl space-y-6">
      {!portfolio && <Rename appId={app.id} name={app.name} />}
      <AppSources app={app} apps={apps} assets={assets} />
      {!portfolio && <RemoveApp appId={app.id} name={app.name} />}
    </div>
  )
}

function Rename(props: { appId: string; name: string }) {
  const rename = useServerFn(renameAppFn)
  const queryClient = useQueryClient()
  const [name, setName] = useState(props.name)
  const mutation = useMutation({
    mutationFn: () => rename({ data: { appId: props.appId, name } }),
    onSuccess: async (result) => {
      if (result.ok) await queryClient.invalidateQueries()
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
        <input
          id="app-name"
          required
          maxLength={80}
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="min-w-0 flex-1 field"
        />
        <Button type="submit" disabled={mutation.isPending || unchanged}>
          {mutation.isPending ? 'Saving…' : 'Save name'}
        </Button>
      </form>
      <div role="status" className="mt-2 text-[13px] text-ink-soft empty:hidden">
        {mutation.isError && 'Could not reach the dashboard server. Try again.'}
        {result && !result.ok && result.message}
        {result?.ok && unchanged && 'Saved.'}
      </div>
      </SettingRow>
    </Panel>
  )
}
