import { useSuspenseQuery } from '@tanstack/react-query'
import { Link, createFileRoute, notFound } from '@tanstack/react-router'
import { AppFlow, canDrawFlow } from '@/components/AppFlow'
import { AppFunnel, canDrawFunnel } from '@/components/AppFunnel'
import { DownloadsByStore } from '@/components/DownloadsByStore'
import { PostsPanel } from '@/components/PostsTable'
import { RangeSwitch } from '@/components/RangeSwitch'
import { Timeline } from '@/components/Timeline'
import { Panel } from '@/components/Panel'
import { POSTS_LIMIT } from '@/fns/portfolio'
import { formatCount, formatDay } from '@/lib/format'
import { appsQuery, flowQuery, postsQuery, timelineQuery } from '@/lib/queries'
import { RANGE_DAYS, rangeToDates } from '@/lib/range'

const SOCIAL = new Set(['tiktok', 'instagram', 'facebook', 'youtube'])

/** An app's numbers over the chosen range, and the posts published in it. */
export const Route = createFileRoute('/_app/apps/$appId/')({
  loaderDeps: ({ search }) => ({ range: search.range }),
  loader: async ({ context, params, deps }) => {
    const dates = rangeToDates(deps.range)
    const [timeline] = await Promise.all([
      context.queryClient.ensureQueryData(timelineQuery(params.appId, dates)),
      context.queryClient.ensureQueryData(postsQuery(params.appId, dates)),
      context.queryClient.ensureQueryData(flowQuery(params.appId, dates)),
      context.queryClient.ensureQueryData(appsQuery()),
    ])
    if (!timeline) throw notFound()
  },
  component: AppOverview,
})

function AppOverview() {
  const { appId } = Route.useParams()
  const { range } = Route.useSearch()
  const dates = rangeToDates(range)
  const { data } = useSuspenseQuery(timelineQuery(appId, dates))
  const { data: posts } = useSuspenseQuery(postsQuery(appId, dates))
  const { data: flow } = useSuspenseQuery(flowQuery(appId, dates))
  const { data: apps } = useSuspenseQuery(appsQuery())
  // The loader has already turned a missing app into the not-found page.
  if (!data) return null
  const app = apps.find((entry) => entry.id === appId)
  // The sources something feeds this app from, e.g. `app_store` or `tiktok`.
  const connected = new Set(app?.assets.map((asset) => asset.source))
  const hasSocialAccount = [...connected].some((source) => SOCIAL.has(source))

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          {formatDay(data.range.from)} to {formatDay(data.range.to)}, {RANGE_DAYS[range]} days
        </p>
        <RangeSwitch current={range} />
      </div>
      <Timeline
        days={data.days}
        series={data.series}
        posts={posts}
        connected={connected}
        tiktokDailyFrom={data.tiktokDailyFrom ?? null}
      />
      {/* Hidden while neither can draw, as for an app with only a store connected. */}
      {flow && (canDrawFunnel(flow) || canDrawFlow(flow)) && (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <Panel
            title="Funnel"
            description="Totals over the range. Widths are on a log scale, so every stage shows; the numbers are exact. Stages are counted over the same days, not person by person."
          >
            <AppFunnel flow={flow} />
          </Panel>
          <Panel
            title="Where downloads went"
            description="Experimental. Downloads by store, the trials and paid subscriptions that followed, and what became of the trials started in the range. Widths are to scale."
          >
            <AppFlow flow={flow} />
          </Panel>
        </div>
      )}
      <DownloadsByStore timeline={data} />
      <PostsPanel
        title="Posts"
        description="Published in this range, newest first; select a column heading to sort by it. Totals are lifetime numbers from the last sync. Download lift compares downloads on the post's day and the two after with the week before's pace; posts close together share those days."
        posts={posts}
        sortBy="posted"
        label="Posts published in this range, with lifetime totals and download lift"
        empty={<NoPosts hasSocialAccount={hasSocialAccount} appId={appId} />}
        footer={
          posts.length >= POSTS_LIMIT ? `The newest ${formatCount(POSTS_LIMIT)} posts of the range.` : undefined
        }
      />
    </>
  )
}

function NoPosts(props: { hasSocialAccount: boolean; appId: string }) {
  return (
    <p className="px-5 py-6 text-muted-foreground">
      {props.hasSocialAccount ? (
        'No posts were published in this range.'
      ) : (
        <>
          No social account is linked to this app yet.{' '}
          <Link
            to="/apps/$appId/settings"
            params={{ appId: props.appId }}
            search={(previous) => previous}
            className="font-medium text-foreground underline underline-offset-4"
          >
            Link one in Settings
          </Link>
        </>
      )}
    </p>
  )
}
