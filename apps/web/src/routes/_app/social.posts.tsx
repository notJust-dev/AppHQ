import { useSuspenseQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { PageBody } from '@/components/PageHeader'
import { PostsPanel } from '@/components/PostsTable'
import { PerformanceHeader } from '@/components/performance/PerformanceHeader'
import { POSTS_LIMIT } from '@/fns/portfolio'
import { formatCount } from '@/lib/format'
import { postsQuery } from '@/lib/queries'
import { rangeToDates } from '@/lib/range'

/** Social › Posts: every post published in the range, for the chosen app or all of them. */
export const Route = createFileRoute('/_app/social/posts')({
  loaderDeps: ({ search }) => ({ range: search.range, app: search.app }),
  loader: ({ context, deps }) => context.queryClient.ensureQueryData(postsQuery(deps.app, rangeToDates(deps.range))),
  component: PostsPage,
})

function PostsPage() {
  const { range, app } = Route.useSearch()
  const dates = rangeToDates(range)
  const { data: posts } = useSuspenseQuery(postsQuery(app, dates))

  return (
    <>
      <PerformanceHeader
        title="Posts"
        crumbs={[{ label: 'Social', to: '/social' }]}
        description="Every post published in the range, newest first."
        range={range}
        dates={dates}
        compared={false}
      />
      <PageBody>
        <PostsPanel
          title={posts.length === 1 ? '1 post' : `${formatCount(posts.length)} posts`}
          description="Select a column heading to sort by it. Totals are lifetime numbers from the last sync. Download lift compares downloads on the post's day and the two after with the week before's pace; posts close together share those days."
          posts={posts}
          sortBy="posted"
          // Across apps, each post names its app.
          showApp={!app}
          label="Posts published in this range, with lifetime totals and download lift"
          empty={
            <p className="px-5 py-6 text-muted-foreground">
              No posts were published in this range. Posts come from TikTok, Instagram, Facebook and YouTube accounts
              linked to an app; connect them on the{' '}
              <Link to="/settings/integrations" className="font-medium text-foreground underline underline-offset-4">
                Accounts page
              </Link>
              .
            </p>
          }
          footer={posts.length >= POSTS_LIMIT ? `The newest ${formatCount(POSTS_LIMIT)} posts of the range.` : undefined}
        />
      </PageBody>
    </>
  )
}
