import { Link } from '@tanstack/react-router'
import { formatCount, formatDay } from '../lib/format'
import { liftSentence, liftShort } from '../lib/lift'
import type { Post } from '../lib/queries'
import { sourceLabel } from '../lib/sources'

/**
 * The app's posts published in the range, newest first. The totals are lifetime numbers from
 * the last sync, so a post from yesterday has had far less time than one from last month.
 */
export function PostsTable(props: { posts: Post[]; hasSocialAccount: boolean; appId: string }) {
  if (props.posts.length === 0) {
    return (
      <p className="rounded-lg border border-line bg-surface px-6 py-5 text-sm text-ink-soft">
        {props.hasSocialAccount ? (
          'No posts were published in this range.'
        ) : (
          <>
            No social account is linked to this app yet.{' '}
            <Link
              to="/apps/$appId/settings"
              params={{ appId: props.appId }}
              search={(previous) => previous}
              className="font-medium text-ink underline"
            >
              Link one in Settings
            </Link>
          </>
        )}
      </p>
    )
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full min-w-[760px] border-collapse text-sm">
        <caption className="sr-only">
          Posts published in this range, newest first, with lifetime totals and download lift
        </caption>
        <thead>
          <tr className="border-b border-line text-left text-ink-soft">
            <th scope="col" className="px-6 py-3 font-medium">
              Posted
            </th>
            <th scope="col" className="px-6 py-3 font-medium">
              Post
            </th>
            {['Views', 'Likes', 'Comments', 'Shares'].map((label) => (
              <th key={label} scope="col" className="px-4 py-3 text-right font-medium">
                {label}
              </th>
            ))}
            <th scope="col" className="px-6 py-3 text-right font-medium whitespace-nowrap">
              Download lift
            </th>
          </tr>
        </thead>
        <tbody>
          {props.posts.map((post) => (
            <tr key={post.id} className="border-b border-line align-top last:border-b-0">
              <td className="figures whitespace-nowrap px-6 py-3">
                {formatDay(post.publishedAt.slice(0, 10))}
                <span className="block text-xs text-ink-soft">{sourceLabel(post.platform)}</span>
              </td>
              <td className="max-w-[22rem] px-6 py-3">
                {post.url ? (
                  <a
                    href={post.url}
                    target="_blank"
                    rel="noreferrer"
                    className="line-clamp-2 underline decoration-line underline-offset-4 hover:decoration-ink"
                  >
                    {post.caption || 'Untitled post'}
                  </a>
                ) : (
                  <span className="line-clamp-2">{post.caption || 'Untitled post'}</span>
                )}
              </td>
              {[post.views, post.likes, post.comments, post.shares].map((value, index) => (
                <td key={index} className="figures px-4 py-3 text-right">
                  {formatCount(value)}
                </td>
              ))}
              <td
                className={`figures px-6 py-3 text-right whitespace-nowrap ${
                  post.downloadLift.status === 'ok' ? '' : 'text-ink-soft'
                }`}
                title={liftSentence(post.downloadLift, post.publishedAt.slice(0, 10))}
              >
                {liftShort(post.downloadLift)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
