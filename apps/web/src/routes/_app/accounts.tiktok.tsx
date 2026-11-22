import { useMutation, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { useCallback, useState } from 'react'
import { z } from 'zod'
import { Private } from '@/components/Private'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import {
  AccountList,
  ConnectResult,
  DeveloperSetup,
  Section,
  SourcePage,
  emptyFamily,
  useWatch,
} from '@/components/accounts/shared'
import { startTikTokConnectFn } from '@/fns/tiktok'
import { accountsQuery, appsQuery, tiktokSetupQuery, type AppSummary, type TikTokSetup } from '@/lib/queries'

export const Route = createFileRoute('/_app/accounts/tiktok')({
  // Set by the TikTok sign-in when it sends the browser back here.
  validateSearch: z.object({ connected: z.literal('tiktok').optional().catch(undefined) }),
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(accountsQuery()),
      context.queryClient.ensureQueryData(appsQuery()),
      context.queryClient.ensureQueryData(tiktokSetupQuery()),
    ]),
  component: TikTokPage,
})

function TikTokPage() {
  const { connected } = Route.useSearch()
  const navigate = useNavigate()
  const watch = useWatch()
  const { data: families } = useSuspenseQuery({ ...accountsQuery(), refetchInterval: watch.refetchInterval })
  const { data: apps } = useSuspenseQuery(appsQuery())
  const { data: setup } = useSuspenseQuery(tiktokSetupQuery())
  const family = families.find((entry) => entry.family === 'tiktok') ?? emptyFamily('tiktok')
  const clear = useCallback(() => {
    void navigate({ to: '/accounts/tiktok', search: {}, replace: true })
  }, [navigate])

  return (
    <SourcePage
      title="TikTok"
      intro="Views and followers for each TikTok account you connect. TikTok keeps no daily history, so daily views start the day after an account is connected: the sooner it is connected, the more history the charts have."
    >
      <ConnectResult connected={connected} clear={clear} onConnected={watch.dataChanged} />

      <Section title="Accounts" flush>
        <AccountList accounts={family.accounts} />
      </Section>

      <Section
        title={
          family.accounts.some((account) => account.status === 'needs_reauth')
            ? 'Connect an account again, or add one'
            : family.accounts.length > 0
              ? 'Connect another account'
              : 'Connect'
        }
        intro={
          family.accounts.some((account) => account.status === 'needs_reauth')
            ? 'To connect an account again, pick its app and sign in with it on TikTok.'
            : undefined
        }
      >
        <ConnectTikTok apps={apps} setup={setup} />
      </Section>

      <DeveloperSetup summary="Setting up the TikTok app">
        <p>
          Create an app (or a sandbox of one) at developers.tiktok.com with Login Kit for web and the
          scopes <code>user.info.basic</code>, <code>user.info.profile</code>,{' '}
          <code>user.info.stats</code> and <code>video.list</code>.
        </p>
        <p>
          Set <code>TIKTOK_CLIENT_KEY</code> and <code>TIKTOK_CLIENT_SECRET</code> on the api app (a
          sandbox has its own pair). With a sandbox, only accounts added as target users can sign in.
        </p>
        <p>
          Redirect URI, exactly as written:{' '}
          <code className="break-all">{setup.redirectUri}</code>
        </p>
      </DeveloperSetup>
    </SourcePage>
  )
}

function ConnectTikTok(props: { apps: AppSummary[]; setup: TikTokSetup }) {
  const start = useServerFn(startTikTokConnectFn)
  const [appId, setAppId] = useState(props.apps[0]?.id ?? '')
  const mutation = useMutation({
    mutationFn: () => start({ data: { appId } }),
    onSuccess: (result) => {
      if (result.ok) window.location.assign(result.url)
    },
  })
  const result = mutation.data
  const leaving = mutation.isPending || result?.ok === true

  if (!props.setup.configured) {
    return (
      <p className="text-sm">
        TikTok is not set up on the API yet. See &quot;Setting up the TikTok app&quot; below, then
        reload this page.
      </p>
    )
  }
  if (props.apps.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Add an app first: a TikTok account is connected to the app it promotes.
      </p>
    )
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        mutation.mutate()
      }}
    >
      <Label htmlFor="tiktok-app">App this account promotes</Label>
      <div className="mt-2 flex flex-wrap gap-2">
        <Select value={appId} onValueChange={setAppId}>
          <SelectTrigger id="tiktok-app" className="min-w-0 flex-1 basis-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {props.apps.map((app) => (
              <SelectItem key={app.id} value={app.id}>
                {app.kind === 'portfolio' ? 'Shared accounts (promotes several apps)' : <Private>{app.name}</Private>}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="submit" disabled={leaving}>
          {leaving && <Spinner />}
          {leaving ? 'Opening TikTok…' : 'Connect TikTok'}
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        You sign in on TikTok itself and come back here. You can move the account to another app
        later on the Apps page.
      </p>
      <div role="status" className="mt-3 text-sm text-destructive empty:hidden">
        {mutation.isError && 'Could not reach the dashboard server. Try again.'}
        {result && !result.ok && result.message}
      </div>
    </form>
  )
}
