import { useMutation, useSuspenseQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { CircleCheck } from 'lucide-react'
import { useState } from 'react'
import { Private } from '@/components/Private'
import { KeyFileField, checkServiceAccount, serviceAccountEmail } from '@/components/accounts/KeyFileField'
import { AccountList, Found, Section, SourcePage, Steps, emptyFamily, useWatch } from '@/components/accounts/shared'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { connectSearchConsoleFn } from '@/fns/search'
import { accountsQuery } from '@/lib/queries'

export const Route = createFileRoute('/_app/accounts/search-console')({
  loader: ({ context }) => context.queryClient.ensureQueryData(accountsQuery()),
  component: SearchConsolePage,
})

type ConnectOutcome = { serviceAccount: string; sites: number; linked: number }

function SearchConsolePage() {
  const watch = useWatch()
  const { data: families } = useSuspenseQuery({ ...accountsQuery(), refetchInterval: watch.refetchInterval })
  const family = families.find((entry) => entry.family === 'search_console') ?? emptyFamily('search_console')
  const play = families.find((entry) => entry.family === 'google_play')?.accounts[0]
  const account = family.accounts[0]
  const [replacing, setReplacing] = useState(false)
  const [outcome, setOutcome] = useState<ConnectOutcome | null>(null)
  const onConnected = (result: ConnectOutcome) => {
    setOutcome(result)
    setReplacing(false)
    watch.dataChanged()
  }

  return (
    <SourcePage
      family="search_console"
      title="Google Search Console"
      intro="Clicks, impressions and average position from Google search, for the website of each app you track, and its top queries and pages. Google keeps 16 months and posts each day two or three days late."
    >
      <Section title="Account" flush>
        <AccountList accounts={family.accounts} />
        <Found family={family} />
      </Section>

      {outcome && (
        <Alert role="status">
          <CircleCheck aria-hidden="true" />
          <AlertDescription>
            <p>
              Connected. {outcome.sites} {outcome.sites === 1 ? 'website' : 'websites'} found
              {outcome.linked > 0 && `, ${outcome.linked} already part of an app`}.{' '}
              {outcome.sites > outcome.linked && (
                <>
                  Link each to its app on the <Link to="/apps">Apps page</Link> or in the app&apos;s Settings; its
                  history is fetched once it has an app.
                </>
              )}
            </p>
          </AlertDescription>
        </Alert>
      )}

      {account && !replacing ? (
        <div>
          <Button variant="outline" onClick={() => setReplacing(true)}>
            Use a different service account
          </Button>
        </div>
      ) : (
        <Section title={account ? 'Use a different service account' : 'Connect'}>
          <Steps>
            <li>
              Pick a Google Cloud service account. The one Google Play uses works; otherwise create one under IAM and
              admin, Service accounts, and download a JSON key.
            </li>
            <li>In that service account&apos;s Cloud project, enable the Google Search Console API.</li>
            <li>
              In Search Console, open each website&apos;s Settings, Users and permissions, and add the service
              account&apos;s email with Restricted permission.
            </li>
            <li>Connect below, then link each website to its app.</li>
          </Steps>
          <ConnectForm playAccount={play?.displayName ?? null} onConnected={onConnected} />
          {account && (
            <div className="mt-4">
              <Button variant="outline" onClick={() => setReplacing(false)}>
                Keep the current service account
              </Button>
            </div>
          )}
        </Section>
      )}
    </SourcePage>
  )
}

function ConnectForm(props: { playAccount: string | null; onConnected: (result: ConnectOutcome) => void }) {
  const connect = useServerFn(connectSearchConsoleFn)
  const [key, setKey] = useState('')
  const mutation = useMutation({
    mutationFn: (input: { serviceAccountJson?: string; usePlayKey?: boolean }) => connect({ data: input }),
    onSuccess: (result) => {
      if (!result.ok) return
      setKey('')
      props.onConnected(result)
    },
  })
  const result = mutation.data
  const keyReady = key !== '' && checkServiceAccount(key) === null
  const email = keyReady ? serviceAccountEmail(key) : null

  return (
    <div className="space-y-5">
      {props.playAccount && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3">
          <p className="min-w-0 text-sm">
            Use the Google Play service account,{' '}
            <Private className="font-medium break-all">{props.playAccount}</Private>
          </p>
          <Button disabled={mutation.isPending} onClick={() => mutation.mutate({ usePlayKey: true })}>
            {mutation.isPending && mutation.variables?.usePlayKey && <Spinner />}
            Connect with this account
          </Button>
        </div>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (keyReady) mutation.mutate({ serviceAccountJson: key })
        }}
      >
        <KeyFileField
          label={props.playAccount ? 'Or another service account key' : 'Service account key'}
          accept=".json,application/json"
          fileHint="the JSON key file"
          pastePlaceholder="Paste the whole JSON key file"
          value={key}
          check={checkServiceAccount}
          onChange={(text) => setKey(text)}
        />
        {email && (
          <p className="mt-2 text-xs text-muted-foreground">
            Search Console must have added <Private className="font-medium break-all text-foreground">{email}</Private>.
          </p>
        )}
        <div className="mt-4">
          <Button type="submit" variant={props.playAccount ? 'outline' : 'default'} disabled={mutation.isPending || !keyReady}>
            {mutation.isPending && !mutation.variables?.usePlayKey && <Spinner />}
            Connect Search Console
          </Button>
        </div>
      </form>
      <div role="status" className="text-sm text-destructive empty:hidden">
        {mutation.isError && 'Could not reach the dashboard server. Try again.'}
        {result && !result.ok && result.message}
      </div>
    </div>
  )
}
