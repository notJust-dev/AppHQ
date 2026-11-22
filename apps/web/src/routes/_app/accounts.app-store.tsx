import { useMutation, useSuspenseQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { CircleCheck } from 'lucide-react'
import { useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { KeyFileField, checkP8, keyIdFromFileName } from '@/components/accounts/KeyFileField'
import {
  AccountList,
  Found,
  Section,
  SourcePage,
  Steps,
  emptyFamily,
  useWatch,
} from '@/components/accounts/shared'
import { connectAppStoreFn } from '@/fns/settings'
import { accountsQuery } from '@/lib/queries'

export const Route = createFileRoute('/_app/accounts/app-store')({
  loader: ({ context }) => context.queryClient.ensureQueryData(accountsQuery()),
  component: AppStorePage,
})

function AppStorePage() {
  const watch = useWatch()
  const { data: families } = useSuspenseQuery({ ...accountsQuery(), refetchInterval: watch.refetchInterval })
  const family = families.find((entry) => entry.family === 'app_store') ?? emptyFamily('app_store')
  const account = family.accounts[0]
  const [replacing, setReplacing] = useState(false)
  const [outcome, setOutcome] = useState<ConnectOutcome | null>(null)

  return (
    <SourcePage
      title="App Store Connect"
      intro="Daily downloads from Apple's sales reports, and store page views and impressions from its analytics reports, for the iOS apps you track. Downloads go back a year, page views to January 2024."
    >
      <Section title="Account" flush>
        <AccountList accounts={family.accounts} />
        <Found family={family} />
      </Section>

      {outcome && (
        <Alert role="status">
          <CircleCheck aria-hidden="true" />
          <AlertDescription>
            <Connected result={outcome} />
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
              In App Store Connect, open Users and Access, then Integrations, then App Store Connect
              API, and the Team Keys tab.
            </li>
            <li>
              Generate a key with the Admin role. Downloads only need Sales and Reports, but store
              page views and impressions come from analytics reports, and only an Admin key may ask
              Apple to start them. After that, a Sales and Reports key can read them.
            </li>
            <li>Download the key file. Apple offers the download only once, so keep it safe.</li>
            <li>Copy the Issuer ID shown above the list of keys.</li>
            <li>Your vendor number is in Payments and Financial Reports, next to your name.</li>
            <li>
              Connect below, then add the apps you want to track on the Apps page. Nothing is added
              on its own.
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

type ConnectOutcome = {
  apps: number
  linked: number
}

function ConnectForm({ onConnected }: { onConnected: (result: ConnectOutcome) => void }) {
  const connect = useServerFn(connectAppStoreFn)
  const empty = { issuerId: '', keyId: '', vendorNumber: '', privateKey: '' }
  const [fields, setFields] = useState(empty)
  const set = (name: keyof typeof empty) => (event: { target: { value: string } }) =>
    setFields((current) => ({ ...current, [name]: event.target.value }))

  const mutation = useMutation({
    mutationFn: () => connect({ data: fields }),
    onSuccess: (result) => {
      if (!result.ok) return
      setFields(empty)
      onConnected(result)
    },
  })
  const result = mutation.data
  const keyReady = fields.privateKey !== '' && checkP8(fields.privateKey) === null

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        if (keyReady) mutation.mutate()
      }}
    >
      <KeyFileField
        label="Key file"
        accept=".p8"
        fileHint="AuthKey_….p8"
        pastePlaceholder="Paste the contents of the .p8 file, including the BEGIN and END lines"
        value={fields.privateKey}
        check={checkP8}
        onChange={(text, fileName) =>
          setFields((current) => ({
            ...current,
            privateKey: text,
            // Apple names the file after the key, so the Key ID comes with it.
            keyId: keyIdFromFileName(fileName) ?? current.keyId,
          }))
        }
      />
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <Field>
          <FieldLabel htmlFor="app-store-keyId">Key ID</FieldLabel>
          <Input
            id="app-store-keyId"
            type="text"
            autoComplete="off"
            spellCheck={false}
            required
            minLength={4}
            value={fields.keyId}
            onChange={set('keyId')}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="app-store-issuerId">Issuer ID</FieldLabel>
          <Input
            id="app-store-issuerId"
            type="text"
            autoComplete="off"
            spellCheck={false}
            required
            minLength={8}
            value={fields.issuerId}
            onChange={set('issuerId')}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="app-store-vendorNumber">Vendor number</FieldLabel>
          <Input
            id="app-store-vendorNumber"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            required
            pattern="[0-9]{4,15}"
            title="Digits only. It is shown in Payments and Financial Reports."
            value={fields.vendorNumber}
            onChange={set('vendorNumber')}
          />
        </Field>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Stored encrypted on the API. The key is not shown again and never reaches the browser after
        this.
      </p>
      <div className="mt-4">
        <Button type="submit" disabled={mutation.isPending || !keyReady}>
          {mutation.isPending && <Spinner />}
          {mutation.isPending ? 'Connecting…' : 'Connect App Store Connect'}
        </Button>
      </div>
      <div role="status" className="mt-3 text-sm text-destructive empty:hidden">
        {mutation.isError && 'Could not reach the dashboard server. Try again.'}
        {result && !result.ok && result.message}
      </div>
    </form>
  )
}

function Connected(props: { result: ConnectOutcome }) {
  const { apps, linked } = props.result
  const waiting = apps - linked
  return (
    <>
      <p>
        Connected. {apps} {apps === 1 ? 'app' : 'apps'} found
        {linked > 0 && `, ${linked} already part of an app`}.{' '}
        {waiting > 0 && (
          <>
            Add the ones you want to track on the{' '}
            <Link to="/apps" className="font-medium underline underline-offset-4">
              Apps page
            </Link>
            ; a year of downloads is fetched for each one you add. Store page views follow a day
            or two later, once Apple has made the analytics reports, back to January 2024.
          </>
        )}
      </p>
    </>
  )
}
