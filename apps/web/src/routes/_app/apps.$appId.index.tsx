import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, notFound } from '@tanstack/react-router'
import { PostsTable } from '../../components/PostsTable'
import { RangeSwitch } from '../../components/RangeSwitch'
import { Timeline } from '../../components/Timeline'
import { formatDay } from '../../lib/format'
import { appsQuery, postsQuery, timelineQuery } from '../../lib/queries'
import { RANGE_DAYS, rangeToDates } from '../../lib/range'

const SOCIAL = new Set(['tiktok', 'instagram', 'facebook'])

/** An app's numbers over the chosen range, and the posts published in it. */
export const Route = createFileRoute('/_app/apps/$appId/')({
  loaderDeps: ({ search }) => ({ range: search.range }),
  loader: async ({ context, params, deps }) => {
    const dates = rangeToDates(deps.range)
    const [timeline] = await Promise.all([
      context.queryClient.ensureQueryData(timelineQuery(params.appId, dates)),
      context.queryClient.ensureQueryData(postsQuery(params.appId, dates)),
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
        <p className="text-sm text-ink-soft">
          {formatDay(data.range.from)} to {formatDay(data.range.to)}, {RANGE_DAYS[range]} days
        </p>
        <RangeSwitch current={range} />
      </div>
      <div className="mt-6">
        <Timeline days={data.days} series={data.series} posts={posts} connected={connected} />
      </div>
      <section className="mt-12" aria-labelledby="posts-heading">
        <h2 id="posts-heading" className="font-display text-xl font-semibold tracking-tight">
          Posts
        </h2>
        <p className="mt-1 text-sm text-ink-soft">
          Published in this range, newest first. Totals are lifetime numbers from the last sync.
          Download lift compares downloads on the post&apos;s day and the two after with the
          week before&apos;s pace; posts close together share those days.
        </p>
        <div className="mt-4">
          <PostsTable posts={posts} hasSocialAccount={hasSocialAccount} appId={appId} />
        </div>
      </section>
    </>
  )
}
