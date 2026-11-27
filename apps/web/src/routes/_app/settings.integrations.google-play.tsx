import { useMutation, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { CircleCheck } from 'lucide-react'
import { useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Private } from '@/components/Private'
import { KeyFileField, checkServiceAccount, serviceAccountEmail } from '@/components/integrations/KeyFileField'
import {
  AccountList,
  Found,
  Section,
  SourcePage,
  Steps,
  emptyFamily,
  useWatch,
} from '@/components/integrations/shared'
import { connectGooglePlayFn } from '@/fns/google-play'
import { accountsQuery } from '@/lib/queries'

export const Route = createFileRoute('/_app/settings/integrations/google-play')({
  loader: ({ context }) => context.queryClient.ensureQueryData(accountsQuery()),
  component: GooglePlayPage,
})

type ConnectOutcome = { serviceAccount: string; packages: number; matched: number }

function GooglePlayPage() {
  const watch = useWatch()
  const { data: families } = useSuspenseQuery({ ...accountsQuery(), refetchInterval: watch.refetchInterval })
  const family = families.find((entry) => entry.family === 'google_play') ?? emptyFamily('google_play')
  const account = family.accounts[0]
  const [replacing, setReplacing] = useState(false)
  const [outcome, setOutcome] = useState<ConnectOutcome | null>(null)

  return (
    <SourcePage
      family="google_play"
      title="Google Play"
      intro="Installs, store listing visitors and written reviews for every Android app in your developer account, from the monthly reports Google Play keeps in a Cloud Storage bucket. Google posts the numbers 3 to 7 days late."
    >
      <Section title="Account" flush>
        <AccountList accounts={family.accounts} detail={(entry) => entry.externalAccountId} />
        <Found family={family} />
      </Section>

      {outcome && (
        <Alert role="status">
          <CircleCheck aria-hidden="true" />
          <AlertDescription>
            Connected. {outcome.packages} {outcome.packages === 1 ? 'package' : 'packages'} found
            {outcome.matched > 0 && `, ${outcome.matched} linked to an app`}.
            {outcome.matched < outcome.packages &&
              " Link the rest on the Apps page; each one's year of installs is fetched once it has an app."}
          </AlertDescription>
        </Alert>
      )}

      {account && !replacing ? (
        <div>
          <Button variant="outline" onClick={() => setReplacing(true)}>Use a different key</Button>
        </div>
      ) : (
        <Section title={account ? 'Use a different key' : 'Connect'}>
          <Steps>
            <li>
              In the Google Cloud console, create a service account in any project, under IAM and
              admin, Service accounts. It needs no roles.
            </li>
            <li>Open it, then Keys, Add key, Create new key, JSON. The key file downloads.</li>
            <li>
              In Play Console, open Users and permissions and invite the service account&apos;s
              email with &quot;View app information and download bulk reports&quot; for all apps.
              Access can take up to a day to start working.
            </li>
            <li>
              In Play Console, open Download reports, then Statistics, and copy the Cloud Storage
              URI.
            </li>
            <li>
              Optional: enable the Google Play Developer Reporting API in the same Cloud project, so
              apps show by title instead of package name.
            </li>
          </Steps>
          <ConnectForm
            onConnected={(result) => {
              setOutcome(result)
              setReplacing(false)
              watch.dataChanged()
            }}
          />
          {account && (
            <div className="mt-4">
              <Button variant="outline" onClick={() => setReplacing(false)}>Keep the current key</Button>
            </div>
          )}
        </Section>
      )}
    </SourcePage>
  )
}

function ConnectForm({ onConnected }: { onConnected: (result: ConnectOutcome) => void }) {
  const connect = useServerFn(connectGooglePlayFn)
  const empty = { serviceAccountJson: '', storageUri: '' }
  const [fields, setFields] = useState(empty)
  const mutation = useMutation({
    mutationFn: () => connect({ data: fields }),
    onSuccess: (result) => {
      if (!result.ok) return
      setFields(empty)
      onConnected(result)
    },
  })
  const result = mutation.data
  const keyReady = fields.serviceAccountJson !== '' && checkServiceAccount(fields.serviceAccountJson) === null
  const email = keyReady ? serviceAccountEmail(fields.serviceAccountJson) : null

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        if (keyReady) mutation.mutate()
      }}
    >
      <KeyFileField
        label="Service account key"
        accept=".json,application/json"
        fileHint="the JSON key file"
        pastePlaceholder="Paste the whole JSON key file"
        value={fields.serviceAccountJson}
        check={checkServiceAccount}
        onChange={(text) => setFields((current) => ({ ...current, serviceAccountJson: text }))}
      />
      {email && (
        <p className="mt-2 text-xs text-muted-foreground">
          Play Console must have invited <Private className="break-all font-medium text-foreground">{email}</Private>.
        </p>
      )}
      <Field className="mt-4">
        <FieldLabel htmlFor="play-storage-uri">Cloud Storage URI</FieldLabel>
        <Input
        id="play-storage-uri"
        type="text"
        autoComplete="off"
        spellCheck={false}
        required
        placeholder="gs://pubsite_prod_rev_01234567890987654321/stats/installs/"
        value={fields.storageUri}
        // The bucket is named after the developer account.
        data-private=""
        onChange={(event) => setFields((current) => ({ ...current, storageUri: event.target.value }))}
        />
      </Field>
      <p className="mt-3 text-xs text-muted-foreground">
        Stored encrypted on the API. The key is not shown again and never reaches the browser after
        this.
      </p>
      <div className="mt-4">
        <Button type="submit" disabled={mutation.isPending || !keyReady}>
          {mutation.isPending && <Spinner />}
          {mutation.isPending ? 'Checking the reports…' : 'Connect Google Play'}
        </Button>
      </div>
      <div role="status" className="mt-3 text-sm text-destructive empty:hidden">
        {mutation.isError && 'Could not reach the dashboard server. Try again.'}
        {result && !result.ok && result.message}
      </div>
    </form>
  )
}
