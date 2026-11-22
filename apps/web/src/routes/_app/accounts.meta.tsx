import { useMutation, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { useCallback } from 'react'
import { AlertTriangle } from 'lucide-react'
import { z } from 'zod'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import {
  AccountList,
  ConnectResult,
  DeveloperSetup,
  Found,
  Section,
  SourcePage,
  emptyFamily,
  useWatch,
  type ConnectedAccount,
} from '@/components/accounts/shared'
import { startMetaConnectFn } from '@/fns/meta'
import { formatDay } from '@/lib/format'
import { metaHealth } from '@/lib/meta'
import { accountsQuery, metaSetupQuery, type MetaSetup } from '@/lib/queries'

export const Route = createFileRoute('/_app/accounts/meta')({
  // Set by the Facebook sign-in when it sends the browser back here.
  validateSearch: z.object({ connected: z.literal('meta').optional().catch(undefined) }),
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(accountsQuery()),
      context.queryClient.ensureQueryData(metaSetupQuery()),
    ]),
  component: MetaPage,
})

function MetaPage() {
  const { connected } = Route.useSearch()
  const navigate = useNavigate()
  const watch = useWatch()
  const { data: families } = useSuspenseQuery({ ...accountsQuery(), refetchInterval: watch.refetchInterval })
  const { data: setup } = useSuspenseQuery(metaSetupQuery())
  const family = families.find((entry) => entry.family === 'meta') ?? emptyFamily('meta')
  const clear = useCallback(() => {
    void navigate({ to: '/accounts/meta', search: {}, replace: true })
  }, [navigate])

  return (
    <SourcePage
      title="Facebook and Instagram"
      intro="One sign-in, with Facebook or Instagram, finds the Pages and Instagram accounts you share with the dashboard. Facebook brings up to a year of daily views, reach and followers; Instagram brings 90 days of daily views. Both bring posts and reels with their views."
    >
      <ConnectResult connected={connected} clear={clear} onConnected={watch.dataChanged} />

      <Section title="Pages and accounts" flush>
        <AccountList accounts={family.accounts} />
        <Found family={family} />
      </Section>

      <Section title={family.accounts.length > 0 ? 'Sign in again' : 'Connect'}>
        <ConnectMeta setup={setup} accounts={family.accounts} />
      </Section>

      <DeveloperSetup summary="Setting up the Meta app">
        <p>
          Create an app at developers.facebook.com, owned by your business portfolio, with the use
          cases &quot;Manage everything on your Page&quot; and &quot;Manage messaging &amp; content
          on Instagram&quot; (API setup with Unified login).
        </p>
        <p>
          Create a login configuration (user access token) with <code>pages_show_list</code>,{' '}
          <code>pages_read_engagement</code>, <code>pages_read_user_content</code>,{' '}
          <code>read_insights</code>, <code>instagram_basic</code>,{' '}
          <code>instagram_manage_insights</code> and <code>business_management</code>.
        </p>
        <p>
          Set <code>META_APP_ID</code>, <code>META_APP_SECRET</code> and{' '}
          <code>META_LOGIN_CONFIG_ID</code> on the api app.
        </p>
        <p>
          Valid OAuth Redirect URI, exactly as written:{' '}
          <code className="break-all">{setup.redirectUri}</code>
        </p>
      </DeveloperSetup>
    </SourcePage>
  )
}

function ConnectMeta(props: { setup: MetaSetup; accounts: ConnectedAccount[] }) {
  const start = useServerFn(startMetaConnectFn)
  const connect = useMutation({
    mutationFn: () => start(),
    onSuccess: (result) => {
      if (result.ok) window.location.assign(result.url)
    },
  })
  const leaving = connect.isPending || connect.data?.ok === true
  const { renewBy, renewSoon, missing } = metaHealth(props.accounts)

  return (
    <>
      {missing.length > 0 && (
        <Alert variant="warning" className="mb-4">
          <AlertTriangle aria-hidden="true" />
          <AlertTitle>Missing permissions</AlertTitle>
          <AlertDescription className="[&_code]:font-mono [&_code]:text-xs">
            The sign-in was not granted {missing.map((scope) => <code key={scope}>{scope} </code>)}
            so some numbers cannot be read. Add them to the login configuration in the Meta app
            (Facebook Login for Business, Configurations), then sign in again.
          </AlertDescription>
        </Alert>
      )}

      {renewBy && (
        <p className={`mb-4 text-sm ${renewSoon ? 'font-medium' : 'text-muted-foreground'}`}>
          Meta lets the sign-in last about 60 days. Sign in again by {formatDay(renewBy.slice(0, 10))}{' '}
          so Instagram keeps syncing; Facebook Pages keep working either way.
        </p>
      )}

      {!props.setup.configured ? (
        <p className="text-sm">
          Facebook and Instagram are not set up on the API yet. See &quot;Setting up the Meta
          app&quot; below, then reload this page.
        </p>
      ) : (
        <>
          <p className="mb-4 text-sm text-muted-foreground">
            You sign in on Facebook and choose which Pages and Instagram accounts to share. Signing
            in again keeps the apps you linked them to.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => connect.mutate()} disabled={leaving}>
              {leaving && <Spinner />}
              {leaving
                ? 'Opening Facebook…'
                : props.accounts.length > 0
                  ? 'Sign in again'
                  : 'Connect Facebook and Instagram'}
            </Button>
            <span role="status" className="text-sm text-destructive">
              {connect.isError && 'Could not reach the dashboard server. Try again.'}
              {connect.data && !connect.data.ok && connect.data.message}
            </span>
          </div>
        </>
      )}
    </>
  )
}
