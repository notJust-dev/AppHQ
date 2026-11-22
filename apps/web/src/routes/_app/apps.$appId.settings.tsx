import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { toast } from 'sonner'
import { AppSources } from '@/components/AppSources'
import { Panel, SettingRow } from '@/components/Panel'
import { RemoveApp } from '@/components/RemoveApp'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { renameAppFn } from '@/fns/assets'
import { appsQuery, assetsQuery } from '@/lib/queries'

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
