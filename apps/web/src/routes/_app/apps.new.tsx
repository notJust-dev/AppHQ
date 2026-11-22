import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { Button } from '../../components/Button'
import { createAppFn } from '../../fns/assets'
import { assetsQuery } from '../../lib/queries'

/** Adds an app by name; its Settings then pick what feeds it. */
export const Route = createFileRoute('/_app/apps/new')({
  loader: ({ context }) => context.queryClient.ensureQueryData(assetsQuery()),
  component: NewAppPage,
})

function NewAppPage() {
  const { data: assets } = useSuspenseQuery(assetsQuery())
  const waiting = assets.filter((asset) => asset.appId === null && !asset.ignored && !asset.social)
  const create = useServerFn(createAppFn)
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const mutation = useMutation({
    mutationFn: (appName: string) => create({ data: { name: appName } }),
    onSuccess: async (result) => {
      if (!result.ok) return
      await queryClient.invalidateQueries()
      await navigate({ to: '/apps/$appId/settings', params: { appId: result.appId }, search: { range: '28d' } })
    },
  })
  const result = mutation.data

  return (
    <div className="max-w-3xl">
      <Link to="/apps" className="text-sm font-medium text-ink-soft hover:text-ink">
        <span aria-hidden="true">← </span>Apps
      </Link>
      <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight">Add an app</h1>
      <p className="mt-2 text-ink-soft">
        Give it a name, then pick what feeds it in its Settings: its iOS and Android apps, its
        RevenueCat project and the social accounts that promote it.
      </p>

      {waiting.length > 0 && (
        <p className="mt-6 rounded-lg border border-line bg-surface px-6 py-4 text-sm">
          Your accounts found {waiting.length} {waiting.length === 1 ? 'app or project' : 'apps and projects'} that
          are not tracked yet. To track one of those, add it from{' '}
          <Link to="/apps" className="font-medium underline underline-offset-4">
            Needs a decision
          </Link>{' '}
          instead, so it keeps its name and history.
        </p>
      )}

      <form
        className="mt-8"
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
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="min-w-0 flex-1 rounded-md border border-line bg-surface px-3 py-2"
          />
          <Button type="submit" variant="primary" disabled={mutation.isPending}>
            {mutation.isPending ? 'Adding…' : 'Add app'}
          </Button>
        </div>
        <p className="mt-2 text-xs text-ink-soft">
          For example an app that is only on Android, or one whose store listing does not exist yet.
        </p>
        <div role="status" className="mt-3 text-sm">
          {mutation.isError && 'Could not reach the dashboard server. Try again.'}
          {result && !result.ok && result.message}
        </div>
      </form>
    </div>
  )
}
