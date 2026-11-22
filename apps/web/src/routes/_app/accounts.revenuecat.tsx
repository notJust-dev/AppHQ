import { useMutation, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { Button } from '../../components/Button'
import {
  AccountList,
  Found,
  Section,
  SourcePage,
  Steps,
  emptyFamily,
  useWatch,
} from '../../components/accounts/shared'
import { connectRevenueCatFn } from '../../fns/settings'
import { accountsQuery } from '../../lib/queries'

export const Route = createFileRoute('/_app/accounts/revenuecat')({
  loader: ({ context }) => context.queryClient.ensureQueryData(accountsQuery()),
  component: RevenueCatPage,
})

function RevenueCatPage() {
  const watch = useWatch()
  const { data: families } = useSuspenseQuery({ ...accountsQuery(), refetchInterval: watch.refetchInterval })
  const family = families.find((entry) => entry.family === 'revenuecat') ?? emptyFamily('revenuecat')
  const connected = family.accounts.length > 0

  return (
    <SourcePage
      title="RevenueCat"
      intro="Revenue, MRR, trials and subscribers, one RevenueCat project at a time. Each project is matched to its app by bundle id or package, or becomes a new app, and about a year of history is fetched."
    >
      <Section title={connected ? 'Projects' : 'Project'}>
        <AccountList accounts={family.accounts} />
        <Found family={family} />
      </Section>

      <Section title={connected ? 'Add another project' : 'Connect'}>
        <Steps>
          <li>In RevenueCat, open the project, then Project settings, API keys.</li>
          <li>
            Create a new secret API key, version 2, with read access to Charts &amp; metrics and to
            Project configuration.
          </li>
          <li>Paste it below. Repeat for each project.</li>
        </Steps>
        <ConnectForm onConnected={watch.dataChanged} />
      </Section>
    </SourcePage>
  )
}

function ConnectForm({ onConnected }: { onConnected: () => void }) {
  const connect = useServerFn(connectRevenueCatFn)
  const [apiKey, setApiKey] = useState('')
  const mutation = useMutation({
    mutationFn: (key: string) => connect({ data: { apiKey: key } }),
    onSuccess: (result) => {
      if (!result.ok) return
      setApiKey('')
      onConnected()
    },
  })
  const result = mutation.data

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        mutation.mutate(apiKey)
      }}
    >
      <label htmlFor="revenuecat-key" className="text-sm font-medium">
        Secret API key
      </label>
      <div className="mt-2 flex flex-wrap gap-3">
        <input
          id="revenuecat-key"
          name="revenuecat-key"
          type="password"
          autoComplete="off"
          required
          minLength={8}
          placeholder="sk_…"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          aria-describedby="revenuecat-key-note"
          className="min-w-0 flex-1 rounded-md border border-line bg-surface px-3 py-2"
        />
        <Button type="submit" variant="primary" disabled={mutation.isPending}>
          {mutation.isPending ? 'Connecting…' : 'Connect project'}
        </Button>
      </div>
      <p id="revenuecat-key-note" className="mt-2 text-xs text-ink-soft">
        Stored encrypted on the API. It is not shown again and never reaches the browser after this.
      </p>
      <div role="status" className="mt-3 text-sm">
        {mutation.isError && 'Could not reach the dashboard server. Try again.'}
        {result && !result.ok && result.message}
        {result?.ok &&
          `Connected ${result.apps.map((app) => app.name).join(', ')}. Its history is being fetched; the numbers appear within a minute.`}
      </div>
    </form>
  )
}
