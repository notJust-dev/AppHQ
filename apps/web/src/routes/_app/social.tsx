import { useSuspenseQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { Megaphone } from 'lucide-react'
import { PageBody } from '@/components/PageHeader'
import { Panel } from '@/components/Panel'
import { AppComparison } from '@/components/performance/AppComparison'
import { ChartRow, ChartStack } from '@/components/performance/ChartStack'
import { DailyChart } from '@/components/performance/DailyChart'
import { PerformanceHeader } from '@/components/performance/PerformanceHeader'
import { Stat, StatGrid } from '@/components/performance/Stat'
import { Button } from '@/components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableRowHead,
} from '@/components/ui/table'
import { formatCompact, formatCount, formatDay, formatRatio } from '@/lib/format'
import { pairedRatio } from '@/lib/performance'
import { liftSentence, liftShort } from '@/lib/lift'
import { socialPerformanceQuery, type SocialPerformance } from '@/lib/queries'
import { performanceSearchSchema, rangeToDates, type RangeKey } from '@/lib/range'
import { sourceLabel } from '@/lib/sources'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_app/social')({
  validateSearch: performanceSearchSchema,
  loaderDeps: ({ search }) => ({ range: search.range, app: search.app }),
  loader: ({ context, deps }) =>
    context.queryClient.ensureQueryData(socialPerformanceQuery({ ...rangeToDates(deps.range), appId: deps.app })),
  component: SocialPage,
})

const percent = (value: number) => `${(value * 100).toFixed(1)}%`

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
              description="Each day's posts, social views and store downloads on one day axis. Views that jump after a post, and downloads that follow a day or two later, are the funnel at work."
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
              description="Daily views as each platform reports them; posts, their lifetime totals and engagement for the posts published in this range."
              bodyClassName=""
            >
              <PlatformTable data={data} />
            </Panel>

            <Panel
              title="Top posts"
              description="This range's most viewed posts. Download lift compares downloads on the post's day and the two after with the week before's pace; posts close together share those days."
              bodyClassName=""
            >
              <TopPosts posts={top} range={range} />
            </Panel>

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

function PlatformTable({ data }: { data: SocialPerformance }) {
  const views = data.series.find((entry) => entry.key === 'views')
  const followers = data.series.find((entry) => entry.key === 'followers')
  const platforms = [
    ...new Set([...(views?.sources.map((part) => part.source) ?? []), ...data.posts.byPlatform.map((entry) => entry.platform)]),
  ]
  const most = Math.max(1, ...platforms.map((platform) => views?.sources.find((part) => part.source === platform)?.summary ?? 0))

  return (
    <Table className="min-w-[720px]">
      <TableHeader>
        <TableRow>
          <TableHead scope="col">Platform</TableHead>
          <TableHead scope="col" className="w-1/4">
            Daily views
          </TableHead>
          <TableHead scope="col" className="text-right">
            Posts
          </TableHead>
          <TableHead scope="col" className="text-right">
            Views per post
          </TableHead>
          <TableHead scope="col" className="text-right">
            Engagement
          </TableHead>
          <TableHead scope="col" className="text-right">
            Followers
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {platforms.map((platform) => {
          const daily = views?.sources.find((part) => part.source === platform)?.summary ?? null
          const posted = data.posts.byPlatform.find((entry) => entry.platform === platform)
          const follower = followers?.sources.find((part) => part.source === platform)?.summary ?? null
          return (
            <TableRow key={platform}>
              <TableRowHead>{sourceLabel(platform)}</TableRowHead>
              <TableCell>
                {daily === null ? (
                  <span className="text-faint">–</span>
                ) : (
                  // The bar is the number's length against the biggest platform; the number says it.
                  <span className="flex items-center gap-3">
                    <span className="h-2 rounded-full bg-views" style={{ width: `${Math.max(2, (daily / most) * 100)}%` }} aria-hidden="true" />
                    <span className="figures shrink-0">{formatCompact(daily)}</span>
                  </span>
                )}
              </TableCell>
              <TableCell className="figures text-right">{posted ? formatCount(posted.posts) : 0}</TableCell>
              <TableCell className="figures text-right">
                {posted && posted.posts > 0 ? formatCompact(posted.views / posted.posts) : <span className="text-faint">–</span>}
              </TableCell>
              <TableCell className="figures text-right">
                {posted && posted.views > 0 ? percent((posted.likes + posted.comments + posted.shares) / posted.views) : <span className="text-faint">–</span>}
              </TableCell>
              <TableCell className="figures text-right">{follower === null ? <span className="text-faint">–</span> : formatCount(follower)}</TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

function TopPosts({ posts, range }: { posts: SocialPerformance['posts']['top']; range: RangeKey }) {
  if (posts.length === 0) {
    return <p className="px-5 py-6 text-muted-foreground">No posts were published in this range.</p>
  }
  return (
    <Table className="min-w-[760px]">
      <TableCaption className="sr-only">This range's most viewed posts, with their lifetime totals and download lift</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">Post</TableHead>
          {['Views', 'Likes', 'Comments', 'Shares', 'Download lift'].map((label) => (
            <TableHead key={label} scope="col" className="text-right">
              {label}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {posts.map((post) => (
          <TableRow key={post.id} className="align-top">
            <TableCell className="max-w-[26rem] align-top">
              {post.url ? (
                <a
                  href={post.url}
                  target="_blank"
                  rel="noreferrer"
                  className="line-clamp-2 underline decoration-border underline-offset-4 hover:decoration-foreground"
                >
                  {post.caption || 'Untitled post'}
                </a>
              ) : (
                <span className="line-clamp-2">{post.caption || 'Untitled post'}</span>
              )}
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {sourceLabel(post.platform)} ·{' '}
                <Link
                  to="/apps/$appId"
                  params={{ appId: post.appId }}
                  search={{ range }}
                  className="hover:text-foreground"
                >
                  {post.appName}
                </Link>{' '}
                · {formatDay(post.publishedAt.slice(0, 10))}
              </span>
            </TableCell>
            {[post.views, post.likes, post.comments, post.shares].map((value, index) => (
              <TableCell key={index} className="figures text-right align-top">
                {formatCount(value)}
              </TableCell>
            ))}
            <TableCell
              className={cn('figures text-right align-top whitespace-nowrap', post.downloadLift.status !== 'ok' && 'text-muted-foreground')}
              title={liftSentence(post.downloadLift, post.publishedAt.slice(0, 10))}
            >
              {liftShort(post.downloadLift)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
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
