import { Link } from '@tanstack/react-router'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatCount, formatDay } from '@/lib/format'
import { liftSentence, liftShort } from '@/lib/lift'
import type { Post } from '@/lib/queries'
import { sourceLabel } from '@/lib/sources'
import { cn } from '@/lib/utils'

/**
 * The app's posts published in the range, newest first. The totals are lifetime numbers from
 * the last sync, so a post from yesterday has had far less time than one from last month.
 */
export function PostsTable(props: { posts: Post[]; hasSocialAccount: boolean; appId: string }) {
  if (props.posts.length === 0) {
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

  return (
    <Table className="min-w-[760px]">
      <TableCaption className="sr-only">
        Posts published in this range, newest first, with lifetime totals and download lift
      </TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">Posted</TableHead>
          <TableHead scope="col">Post</TableHead>
          {['Views', 'Likes', 'Comments', 'Shares'].map((label) => (
            <TableHead key={label} scope="col" className="text-right">
              {label}
            </TableHead>
          ))}
          <TableHead scope="col" className="text-right">
            Download lift
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {props.posts.map((post) => (
          <TableRow key={post.id} className="align-top">
            <TableCell className="figures align-top whitespace-nowrap">
              {formatDay(post.publishedAt.slice(0, 10))}
              <span className="block text-xs text-muted-foreground">{sourceLabel(post.platform)}</span>
            </TableCell>
            <TableCell className="max-w-[22rem] align-top">
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
            </TableCell>
            {[post.views, post.likes, post.comments, post.shares].map((value, index) => (
              <TableCell key={index} className="figures text-right align-top">
                {formatCount(value)}
              </TableCell>
            ))}
            <TableCell
              className={cn(
                'figures text-right align-top whitespace-nowrap',
                post.downloadLift.status !== 'ok' && 'text-muted-foreground',
              )}
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
