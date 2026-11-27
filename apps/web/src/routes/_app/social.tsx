import { useSuspenseQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { createColumnHelper, useTable } from '@tanstack/react-table'
import { Megaphone } from 'lucide-react'
import { useMemo } from 'react'
import { DataTable, sortableFeatures, type SortableFeatures } from '@/components/DataTable'
import { NoData } from '@/components/NoData'
import { PageBody } from '@/components/PageHeader'
import { Panel } from '@/components/Panel'
import { PostsPanel } from '@/components/PostsTable'
import { SourceLogo } from '@/components/SourceLogo'
import { AppComparison } from '@/components/performance/AppComparison'
import { ChartRow, ChartStack } from '@/components/performance/ChartStack'
import { DailyChart } from '@/components/performance/DailyChart'
import { PerformanceHeader } from '@/components/performance/PerformanceHeader'
import { Stat, StatGrid } from '@/components/performance/Stat'
import { Button } from '@/components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { formatCompact, formatCount, formatDay, formatRatio } from '@/lib/format'
import { pairedRatio } from '@/lib/performance'
import { socialPerformanceQuery, type SocialPerformance } from '@/lib/queries'
import { rangeToDates } from '@/lib/range'
import { sourceLabel } from '@/lib/sources'

export const Route = createFileRoute('/_app/social')({
  loaderDeps: ({ search }) => ({ range: search.range, app: search.app }),
  loader: ({ context, deps }) =>
    context.queryClient.ensureQueryData(socialPerformanceQuery({ ...rangeToDates(deps.range), appId: deps.app })),
  component: SocialPage,
})

const percent = (value: number) => `${(value * 100).toFixed(1)}%`
/** Top posts shown at once. The API sends this many of each platform, for the platform filter. */
const TOP_POSTS = 10

function SocialPage() {
  const { range, app } = Route.useSearch()
  const dates = rangeToDates(range)
  const { data } = useSuspenseQuery(socialPerformanceQuery({ ...dates, appId: app }))
  const series = (key: string) => data.series.find((entry) => entry.key === key)
  const views = series('views')
  const followers = series('followers')
  const downloads = series('downloads')
  const { byPlatform, perDay, top } = data.posts

  const postCount = byPlatform.reduce((sum, entry) => sum + entry.posts, 0)
  const postViews = byPlatform.reduce((sum, entry) => sum + entry.views, 0)
  const engagements = byPlatform.reduce((sum, entry) => sum + entry.likes + entry.comments + entry.shares, 0)
  const postsByDay = data.days.map((_, index) => perDay.reduce((sum, entry) => sum + (entry.values[index] ?? 0), 0))
  // Over the apps that report both social views and downloads.
  const perThousand = (ratio: number | null) => (ratio === null ? null : ratio * 1000)

  const hasSocial = (views?.summary ?? null) !== null || postCount > 0
  // TikTok keeps no daily history: before an account was connected, its views sit on each
  // video's post day. Said when the range reaches back that far. `?? null` covers a dashboard
  // briefly newer than the API during a deploy.
  const tiktokDailyFrom = data.tiktokDailyFrom ?? null
  const tiktokNote =
    tiktokDailyFrom && dates.from < tiktokDailyFrom
      ? ` TikTok views before ${formatDay(tiktokDailyFrom)} are each video's views on the day it was posted, as TikTok keeps no daily history.`
      : ''

  return (
    <>
      <PerformanceHeader
        title="Social"
        description="How much you post, how the posts do, and whether the views turn into downloads."
        range={range}
        app={app}
        dates={dates}
      />
      <PageBody>
        {!hasSocial ? (
          <NoSocial />
        ) : (
          <>
            <StatGrid>
              <Stat label="Social views" swatch="bg-views" value={views?.summary ?? null} previous={views?.previous} format={formatCompact} />
              <Stat label="Posts" value={postCount} format={formatCount} hint="Published in this range" compared={false} />
              <Stat
                label="Views per post"
                value={postCount > 0 ? postViews / postCount : null}
                format={formatCompact}
                hint="Lifetime views of this range's posts"
                compared={false}
              />
              <Stat
                label="Engagement rate"
                value={postViews > 0 ? engagements / postViews : null}
                format={percent}
                hint="Likes, comments and shares per view"
                compared={false}
              />
              <Stat label="Followers" value={followers?.summary ?? null} previous={followers?.previous} format={formatCompact} />
              <Stat
                label="Downloads per 1,000 views"
                swatch="bg-downloads"
                value={perThousand(pairedRatio(data.apps, 'downloads', 'views'))}
                previous={perThousand(pairedRatio(data.apps, 'downloads', 'views', { period: 'previous' }))}
                format={formatRatio}
              />
            </StatGrid>

            <Panel
              title="From posts to downloads"
              description={`Each day's posts, social views and store downloads on one day axis. Views that jump after a post, and downloads that follow a day or two later, are the funnel at work.${tiktokNote}`}
              bodyClassName="pb-3"
            >
              <ChartStack>
                <ChartRow label="Posts" swatch="bg-muted-foreground" summary={`${formatCount(postCount)} in this range`}>
                  <DailyChart days={data.days} values={postsByDay} label="Posts" color="var(--muted-foreground)" height={110} />
                </ChartRow>
                <ChartRow label="Social views" swatch="bg-views" summary={views?.summary != null ? formatCount(views.summary) : undefined}>
                  <DailyChart days={data.days} values={views?.values ?? []} label="Social views" color="var(--views)" />
                </ChartRow>
                <ChartRow
                  label="Downloads"
                  swatch="bg-downloads"
                  summary={
                    downloads?.summary != null
                      ? `${formatCount(downloads.summary)}${downloads.completeThrough ? `, through ${formatDay(downloads.completeThrough)}` : ''}`
                      : undefined
                  }
                >
                  <DailyChart days={data.days} values={downloads?.values ?? []} label="Downloads" color="var(--downloads)" />
                </ChartRow>
              </ChartStack>
            </Panel>

            <Panel
              title="By platform"
              description="Daily views as each platform reports them; posts, their lifetime totals and engagement for the posts published in this range. Select a column heading to sort by it."
              bodyClassName=""
            >
              <PlatformTable data={data} />
            </Panel>

            <PostsPanel
              title="Top posts"
              description="The ten most viewed posts of the range, or of one platform; select a column heading to sort them. Download lift compares downloads on the post's day and the two after with the week before's pace; posts close together share those days."
              posts={top}
              sortBy="views"
              limit={TOP_POSTS}
              // Across apps, each post names its app.
              appRange={app ? undefined : range}
              label="This range's most viewed posts, with their lifetime totals and download lift"
              empty={<p className="px-5 py-6 text-muted-foreground">No posts were published in this range.</p>}
            />

            {!app && data.apps.length > 1 && (
              <Panel title="By app" description="Each app's social numbers over the same days. Select a column heading to sort by it." bodyClassName="">
                <AppComparison
                  range={range}
                  sortBy="views"
                  rows={data.apps.map((entry) => ({
                    app: entry.app,
                    values: {
                      views: entry.totals.views,
                      followers: entry.totals.followers,
                      downloads: entry.totals.downloads,
                      conversion: perThousand(pairedRatio([entry], 'downloads', 'views')),
                    },
                  }))}
                  columns={[
                    { key: 'views', label: 'Social views', format: formatCount },
                    { key: 'followers', label: 'Followers', format: formatCount },
                    { key: 'downloads', label: 'Downloads', format: formatCount },
                    { key: 'conversion', label: 'Downloads per 1,000 views', format: formatRatio },
                  ]}
                />
              </Panel>
            )}
          </>
        )}
      </PageBody>
    </>
  )
}

/** One platform's numbers over the range; a number nobody reported is undefined. */
interface PlatformRow {
  platform: string
  dailyViews: number | undefined
  posts: number
  viewsPerPost: number | undefined
  engagement: number | undefined
  followers: number | undefined
}

const platformHelper = createColumnHelper<SortableFeatures, PlatformRow>()

/** A number column: bigger first when sorted, unreported ones last either way. */
const platformNumber = (
  key: 'posts' | 'viewsPerPost' | 'engagement' | 'followers',
  label: string,
  format: (value: number) => string,
) =>
  platformHelper.accessor(key, {
    header: label,
    sortDescFirst: true,
    sortUndefined: 'last',
    meta: { align: 'right', cellClassName: 'figures' },
    cell: (info) => {
      const value = info.getValue()
      return value === undefined ? (
        <span className="text-faint">
          <NoData />
        </span>
      ) : (
        format(value)
      )
    },
  })

function PlatformTable({ data }: { data: SocialPerformance }) {
  const rows = useMemo(() => {
    const views = data.series.find((entry) => entry.key === 'views')
    const followers = data.series.find((entry) => entry.key === 'followers')
    const summary = (series: typeof views, platform: string) =>
      series?.sources.find((part) => part.source === platform)?.summary ?? undefined
    const platforms = [
      ...new Set([...(views?.sources.map((part) => part.source) ?? []), ...data.posts.byPlatform.map((entry) => entry.platform)]),
    ]
    return platforms.map((platform): PlatformRow => {
      const posted = data.posts.byPlatform.find((entry) => entry.platform === platform)
      return {
        platform,
        dailyViews: summary(views, platform),
        posts: posted?.posts ?? 0,
        viewsPerPost: posted && posted.posts > 0 ? posted.views / posted.posts : undefined,
        engagement: posted && posted.views > 0 ? (posted.likes + posted.comments + posted.shares) / posted.views : undefined,
        followers: summary(followers, platform),
      }
    })
  }, [data])
  const most = Math.max(1, ...rows.map((row) => row.dailyViews ?? 0))

  const columns = useMemo(
    () =>
      platformHelper.columns([
        platformHelper.accessor((row) => sourceLabel(row.platform), {
          id: 'platform',
          header: 'Platform',
          sortFn: 'alphanumeric',
          cell: (info) => (
            <span className="inline-flex items-center gap-2">
              <SourceLogo source={info.row.original.platform} decorative className="size-4" />
              {info.getValue()}
            </span>
          ),
        }),
        platformHelper.accessor('dailyViews', {
          header: 'Daily views',
          sortDescFirst: true,
          sortUndefined: 'last',
          meta: { headClassName: 'w-1/4' },
          cell: (info) => {
            const daily = info.getValue()
            return daily === undefined ? (
              <span className="text-faint">
                <NoData />
              </span>
            ) : (
              // The bar is the number's length against the biggest platform; the number says it.
              <span className="flex items-center gap-3">
                <span className="h-2 rounded-full bg-views" style={{ width: `${Math.max(2, (daily / most) * 100)}%` }} aria-hidden="true" />
                <span className="figures shrink-0">{formatCompact(daily)}</span>
              </span>
            )
          },
        }),
        platformNumber('posts', 'Posts', formatCount),
        platformNumber('viewsPerPost', 'Views per post', formatCompact),
        platformNumber('engagement', 'Engagement', percent),
        platformNumber('followers', 'Followers', formatCount),
      ]),
    [most],
  )

  const table = useTable({
    features: sortableFeatures,
    columns,
    data: rows,
    initialState: { sorting: [{ id: 'dailyViews', desc: true }] },
    enableSortingRemoval: false,
  })

  return <DataTable table={table} minWidth={720} />
}

function NoSocial() {
  return (
    <Empty className="border border-dashed bg-card">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Megaphone />
        </EmptyMedia>
        <EmptyTitle>No social numbers in this range</EmptyTitle>
        <EmptyDescription>
          Connect TikTok, Instagram, Facebook or YouTube, then link each account to the app it promotes. Views and posts
          appear here after the next sync.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="flex-row justify-center">
        <Button asChild>
          <Link to="/accounts">Connect accounts</Link>
        </Button>
      </EmptyContent>
    </Empty>
  )
}
