import { Link } from '@tanstack/react-router'
import { formatCount, formatDay } from '../lib/format'
import { liftSentence, liftShort } from '../lib/lift'
import type { Post } from '../lib/queries'
import { TABLE, TD, TH, THEAD_ROW, TR } from './ui/table'
import { sourceLabel } from '../lib/sources'

/**
 * The app's posts published in the range, newest first. The totals are lifetime numbers from
 * the last sync, so a post from yesterday has had far less time than one from last month.
 */
export function PostsTable(props: { posts: Post[]; hasSocialAccount: boolean; appId: string }) {
  if (props.posts.length === 0) {
    return (
      <p className="px-5 py-6 text-ink-soft">
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
    <div className="overflow-x-auto">
      <table className={`${TABLE} min-w-[760px]`}>
        <caption className="sr-only">
          Posts published in this range, newest first, with lifetime totals and download lift
        </caption>
        <thead>
          <tr className={THEAD_ROW}>
            <th scope="col" className={TH}>
              Posted
            </th>
            <th scope="col" className={TH}>
              Post
            </th>
            {['Views', 'Likes', 'Comments', 'Shares'].map((label) => (
              <th key={label} scope="col" className={`${TH} text-right`}>
                {label}
              </th>
            ))}
            <th scope="col" className={`${TH} text-right`}>
              Download lift
            </th>
          </tr>
        </thead>
        <tbody>
          {props.posts.map((post) => (
            <tr key={post.id} className={TR}>
              <td className={`${TD} figures whitespace-nowrap`}>
                {formatDay(post.publishedAt.slice(0, 10))}
                <span className="block text-xs text-ink-soft">{sourceLabel(post.platform)}</span>
              </td>
              <td className={`${TD} max-w-[22rem]`}>
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
                <td key={index} className={`${TD} figures text-right`}>
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
