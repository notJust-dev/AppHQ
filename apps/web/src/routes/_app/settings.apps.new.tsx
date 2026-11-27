import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { Info } from 'lucide-react'
import { useState } from 'react'
import { Panel } from '@/components/Panel'
import { SettingsPage } from '@/components/SettingsPage'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { createAppFn } from '@/fns/assets'
import { assetsQuery } from '@/lib/queries'

/** Adds an app by name; its settings page then picks what feeds it. */
export const Route = createFileRoute('/_app/settings/apps/new')({
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
      await navigate({ to: '/settings/apps/$appId', params: { appId: result.appId } })
    },
  })
  const result = mutation.data
  const problem = mutation.isError
    ? 'Could not reach the dashboard server. Try again.'
    : result && !result.ok
      ? result.message
      : null

  return (
    <SettingsPage
      crumbs={[{ label: 'Apps', to: '/settings/apps' }]}
      title="Add an app"
      description="Give it a name, then pick what feeds it on its settings page: its iOS and Android apps, its RevenueCat project, its website and the social accounts that promote it."
    >
      {waiting.length > 0 && (
        <Alert>
          <Info aria-hidden="true" />
          <AlertDescription>
            <p>
              Your integrations found {waiting.length} {waiting.length === 1 ? 'app or project' : 'apps and projects'}{' '}
              that are not tracked yet. To track one of those, add it from{' '}
              <Link to="/settings/apps">Needs a decision</Link> instead, so it keeps its name and history.
            </p>
          </AlertDescription>
        </Alert>
      )}

      <Panel>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            mutation.mutate(name)
          }}
        >
          <Field data-invalid={problem !== null}>
            <FieldLabel htmlFor="new-app-name">App name</FieldLabel>
            <div className="flex flex-wrap gap-2">
              <Input
                id="new-app-name"
                name="new-app-name"
                required
                maxLength={80}
                autoFocus
                value={name}
                data-private=""
                onChange={(event) => setName(event.target.value)}
                aria-invalid={problem !== null}
                className="min-w-0 flex-1 basis-56"
              />
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending && <Spinner />}
                {mutation.isPending ? 'Adding…' : 'Add app'}
              </Button>
            </div>
            <FieldDescription>
              For example an app that is only on Android, or one whose store listing does not exist yet.
            </FieldDescription>
            {problem && <FieldError>{problem}</FieldError>}
          </Field>
        </form>
      </Panel>
    </SettingsPage>
  )
}
