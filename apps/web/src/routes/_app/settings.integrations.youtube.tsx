import { useMutation, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { useCallback } from 'react'
import { z } from 'zod'
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
} from '@/components/integrations/shared'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { startYouTubeConnectFn } from '@/fns/youtube'
import { accountsQuery, youtubeSetupQuery, type YouTubeSetup } from '@/lib/queries'

export const Route = createFileRoute('/_app/settings/integrations/youtube')({
  // Set by the Google sign-in when it sends the browser back here.
  validateSearch: z.object({ connected: z.literal('youtube').optional().catch(undefined) }),
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(accountsQuery()),
      context.queryClient.ensureQueryData(youtubeSetupQuery()),
    ]),
  component: YouTubePage,
})

function YouTubePage() {
  const { connected } = Route.useSearch()
  const navigate = useNavigate()
  const watch = useWatch()
  const { data: families } = useSuspenseQuery({ ...accountsQuery(), refetchInterval: watch.refetchInterval })
  const { data: setup } = useSuspenseQuery(youtubeSetupQuery())
  const family = families.find((entry) => entry.family === 'youtube') ?? emptyFamily('youtube')
  const clear = useCallback(() => {
    void navigate({ to: '/settings/integrations/youtube', search: {}, replace: true })
  }, [navigate])

  return (
    <SourcePage
      family="youtube"
      title="YouTube"
      intro="Daily views, likes, comments and shares from YouTube Analytics, subscribers, and a year of videos with their views, for each channel you connect. YouTube views count toward social views, like TikTok's and Instagram's."
    >
      <ConnectResult connected={connected} clear={clear} onConnected={watch.dataChanged} />

      <Section title="Channels" flush>
        <AccountList accounts={family.accounts} />
        <Found family={family} />
      </Section>

      <Section title={family.accounts.length > 0 ? 'Connect another channel' : 'Connect'}>
        <ConnectYouTube setup={setup} accounts={family.accounts} />
      </Section>

      <DeveloperSetup summary="Setting up the Google OAuth client">
        <p>
          In Google Cloud, enable the YouTube Data API v3 and the YouTube Analytics API, then create an OAuth client
          of type Web application. Its consent screen needs the scopes <code>youtube.readonly</code> and{' '}
          <code>yt-analytics.readonly</code>; while the app is in testing, add your Google account as a test user.
        </p>
        <p>
          Set <code>GOOGLE_OAUTH_CLIENT_ID</code> and <code>GOOGLE_OAUTH_CLIENT_SECRET</code> on the api app.
        </p>
        <p>
          Authorized redirect URI, exactly as written: <code className="break-all">{setup.redirectUri}</code>
        </p>
      </DeveloperSetup>
    </SourcePage>
  )
}

function ConnectYouTube(props: { setup: YouTubeSetup; accounts: ConnectedAccount[] }) {
  const start = useServerFn(startYouTubeConnectFn)
  const connect = useMutation({
    mutationFn: () => start(),
    onSuccess: (result) => {
      if (result.ok) window.location.assign(result.url)
    },
  })
  const leaving = connect.isPending || connect.data?.ok === true

  if (!props.setup.configured) {
    return (
      <p className="text-sm">
        YouTube is not set up on the API yet. See &quot;Setting up the Google OAuth client&quot; below, then reload this
        page.
      </p>
    )
  }

  return (
    <>
      <p className="mb-4 text-sm text-muted-foreground">
        You sign in with Google and pick the channel; a brand account is a channel of its own, so sign in once for
        each. The dashboard only reads: it cannot upload, edit or comment.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => connect.mutate()} disabled={leaving}>
          {leaving && <Spinner />}
          {leaving ? 'Opening Google…' : props.accounts.length > 0 ? 'Connect another channel' : 'Connect YouTube'}
        </Button>
        <span role="status" className="text-sm text-destructive">
          {connect.isError && 'Could not reach the dashboard server. Try again.'}
          {connect.data && !connect.data.ok && connect.data.message}
        </span>
      </div>
    </>
  )
}
