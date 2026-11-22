import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { AppSources } from '../../components/AppSources'
import { Button } from '../../components/Button'
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
    <div className="max-w-3xl">
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
    <section aria-labelledby="name-heading">
      <h2 id="name-heading" className="font-display text-xl font-semibold tracking-tight">
        Name
      </h2>
      <p className="mt-1 text-sm text-ink-soft">How the app is called across the dashboard. Its address stays the same.</p>
      <form
        className="mt-4 flex flex-wrap gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          if (!unchanged) mutation.mutate()
        }}
      >
        <label htmlFor="app-name" className="sr-only">
          App name
        </label>
        <input
          id="app-name"
          required
          maxLength={80}
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="min-w-0 flex-1 rounded-md border border-line bg-surface px-3 py-2"
        />
        <Button type="submit" disabled={mutation.isPending || unchanged}>
          {mutation.isPending ? 'Saving…' : 'Save name'}
        </Button>
      </form>
      <div role="status" className="mt-2 text-sm">
        {mutation.isError && 'Could not reach the dashboard server. Try again.'}
        {result && !result.ok && result.message}
        {result?.ok && unchanged && 'Saved.'}
      </div>
    </section>
  )
}
