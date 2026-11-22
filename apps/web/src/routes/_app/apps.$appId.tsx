import { useSuspenseQuery } from '@tanstack/react-query'
import { Link, createFileRoute, notFound } from '@tanstack/react-router'
import { AppSources } from '../../components/AppSources'
import { PostsTable } from '../../components/PostsTable'
import { RangeSwitch } from '../../components/RangeSwitch'
import { Timeline } from '../../components/Timeline'
import { formatDay } from '../../lib/format'
import { appsQuery, assetsQuery, postsQuery, timelineQuery } from '../../lib/queries'
import { RANGE_DAYS, rangeSearchSchema, rangeToDates } from '../../lib/range'

const SOCIAL = new Set(['tiktok', 'instagram', 'facebook'])

export const Route = createFileRoute('/_app/apps/$appId')({
  validateSearch: rangeSearchSchema,
  loaderDeps: ({ search }) => ({ range: search.range }),
  loader: async ({ context, params, deps }) => {
    const dates = rangeToDates(deps.range)
    const [timeline] = await Promise.all([
      context.queryClient.ensureQueryData(timelineQuery(params.appId, dates)),
      context.queryClient.ensureQueryData(postsQuery(params.appId, dates)),
      context.queryClient.ensureQueryData(appsQuery()),
      context.queryClient.ensureQueryData(assetsQuery()),
    ])
    if (!timeline) throw notFound()
  },
  component: AppPage,
  notFoundComponent: AppNotFound,
})

function AppPage() {
  const { appId } = Route.useParams()
  const { range } = Route.useSearch()
  const dates = rangeToDates(range)
  const { data } = useSuspenseQuery(timelineQuery(appId, dates))
  const { data: posts } = useSuspenseQuery(postsQuery(appId, dates))
  const { data: apps } = useSuspenseQuery(appsQuery())
  const { data: assets } = useSuspenseQuery(assetsQuery())
  // The loader has already turned a missing app into the not-found page.
  if (!data) return null
  const app = apps.find((entry) => entry.id === appId)
  // The sources something feeds this app from, e.g. `app_store` or `tiktok`.
  const connected = new Set(app?.assets.map((asset) => asset.source))
  const hasSocialAccount = [...connected].some((source) => SOCIAL.has(source))

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">{data.app.name}</h1>
          <p className="mt-1 text-sm text-ink-soft">
            {formatDay(data.range.from)} to {formatDay(data.range.to)}, {RANGE_DAYS[range]} days ·{' '}
            <a href="#sources" className="underline underline-offset-4 hover:text-ink">
              Sources
            </a>
          </p>
        </div>
        <RangeSwitch current={range} />
      </div>
      <div className="mt-8">
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
          <PostsTable posts={posts} hasSocialAccount={hasSocialAccount} />
        </div>
      </section>
      {app && <AppSources app={app} apps={apps} assets={assets} />}
    </>
  )
}

function AppNotFound() {
  return (
    <div className="max-w-xl">
      <h1 className="font-display text-2xl font-semibold">There is no such app</h1>
      <p className="mt-3 text-ink-soft">
        It may have been removed, or the address may be mistyped.{' '}
        <Link to="/" className="font-medium text-ink underline">
          Go to the portfolio
        </Link>
      </p>
    </div>
  )
}
