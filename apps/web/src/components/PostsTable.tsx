import { Link } from '@tanstack/react-router'
import { createColumnHelper, useTable } from '@tanstack/react-table'
import { useMemo, type ReactNode } from 'react'
import { DataTable, sortableFeatures, type SortableFeatures } from '@/components/DataTable'
import { Panel } from '@/components/Panel'
import { PlatformFilter, usePlatformFilter } from '@/components/PlatformFilter'
import { Private } from '@/components/Private'
import { SourceLogo } from '@/components/SourceLogo'
import { formatCount, formatDay } from '@/lib/format'
import { liftSentence, liftShort, type Lift } from '@/lib/lift'
import type { RangeKey } from '@/lib/range'
import { cn } from '@/lib/utils'

/** What a posts table shows of a post; lists across apps also name the post's app. */
export interface PostRow {
  id: string
  platform: string
  url: string | null
  caption: string | null
  publishedAt: string
  views: number
  likes: number
  comments: number
  shares: number
  downloadLift: Lift
  appId?: string
  appName?: string
}

const helper = createColumnHelper<SortableFeatures, PostRow>()

/** A lifetime total; bigger first when sorted. */
const totalColumn = (key: 'views' | 'likes' | 'comments' | 'shares', label: string) =>
  helper.accessor(key, {
    header: label,
    sortDescFirst: true,
    meta: { align: 'right', cellClassName: 'figures' },
    cell: (info) => formatCount(info.getValue()),
  })

/**
 * Posts in a card, with a platform filter in its header when they come from more than one. The
 * totals are lifetime numbers from the last sync, so a post from yesterday has had far less time
 * than one from last month.
 */
export function PostsPanel(props: {
  title: string
  description: string
  posts: PostRow[]
  /** The column the table starts sorted by, newest or biggest first. */
  sortBy: 'posted' | 'views'
  /** Names the table for screen readers. */
  label: string
  /** Shown in place of the table when there are no posts at all. */
  empty: ReactNode
  /**
   * At most this many posts show: the first of the list, of the chosen platform. The list comes
   * most viewed first, so this is the top of the platform.
   */
  limit?: number
  /** Names each post's app under its caption, linked to the app's page over this range. */
  appRange?: RangeKey
  footer?: ReactNode
}) {
  const filter = usePlatformFilter(props.posts)
  const { limit } = props
  const shown = useMemo(() => (limit ? filter.shown.slice(0, limit) : filter.shown), [filter.shown, limit])

  return (
    <Panel
      title={props.title}
      description={props.description}
      actions={
        filter.platforms.length > 1 ? (
          <PlatformFilter platforms={filter.platforms} value={filter.platform} onChange={filter.setPlatform} />
        ) : undefined
      }
      footer={props.footer}
      bodyClassName=""
    >
      {props.posts.length === 0 ? (
        props.empty
      ) : (
        <PostsTable posts={shown} sortBy={props.sortBy} label={props.label} appRange={props.appRange} />
      )}
    </Panel>
  )
}

/** The posts, sorted by any column but the caption. */
function PostsTable(props: { posts: PostRow[]; sortBy: 'posted' | 'views'; label: string; appRange?: RangeKey }) {
  const { appRange } = props
  const columns = useMemo(
    () =>
      helper.columns([
        helper.accessor((post) => Date.parse(post.publishedAt), {
          id: 'posted',
          header: 'Posted',
          sortDescFirst: true,
          meta: { cellClassName: 'figures whitespace-nowrap' },
          // The platform's logo first, so the logos line up down the column.
          cell: (info) => (
            <span className="inline-flex items-center gap-2">
              <SourceLogo source={info.row.original.platform} className="size-4 text-muted-foreground" />
              {formatDay(info.row.original.publishedAt.slice(0, 10))}
            </span>
          ),
        }),
        helper.display({
          id: 'post',
          header: 'Post',
          meta: { cellClassName: 'max-w-[22rem] font-normal' },
          cell: (info) => <Caption post={info.row.original} appRange={appRange} />,
        }),
        totalColumn('views', 'Views'),
        totalColumn('likes', 'Likes'),
        totalColumn('comments', 'Comments'),
        totalColumn('shares', 'Shares'),
        // By downloads above the week before's pace; posts with no number to compare go last.
        helper.accessor((post) => (post.downloadLift.status === 'ok' ? post.downloadLift.change : undefined), {
          id: 'lift',
          header: 'Download lift',
          sortDescFirst: true,
          sortUndefined: 'last',
          meta: { align: 'right', cellClassName: 'figures whitespace-nowrap' },
          cell: (info) => {
            const { downloadLift, publishedAt } = info.row.original
            return (
              <span
                className={cn(downloadLift.status !== 'ok' && 'text-muted-foreground')}
                title={liftSentence(downloadLift, publishedAt.slice(0, 10))}
              >
                {liftShort(downloadLift)}
              </span>
            )
          },
        }),
      ]),
    [appRange],
  )

  const table = useTable({
    features: sortableFeatures,
    columns,
    data: props.posts,
    initialState: { sorting: [{ id: props.sortBy, desc: true }] },
    enableSortingRemoval: false,
  })

  // The caption names the post, so it heads each row; cells line up at the top, as captions
  // run to two lines.
  return <DataTable table={table} minWidth={760} label={props.label} rowHeader="post" rowClassName="*:align-top" />
}

function Caption({ post, appRange }: { post: PostRow; appRange?: RangeKey }) {
  const text = post.caption || 'Untitled post'
  return (
    <>
      {post.url ? (
        <a
          href={post.url}
          target="_blank"
          rel="noreferrer"
          // Captions name the app and its account: privacy mode blurs them.
          data-private=""
          className="line-clamp-2 underline decoration-border underline-offset-4 hover:decoration-foreground"
        >
          {text}
        </a>
      ) : (
        <span data-private="" className="line-clamp-2">
          {text}
        </span>
      )}
      {appRange && post.appId && (
        <Link
          to="/apps/$appId"
          params={{ appId: post.appId }}
          search={{ range: appRange }}
          className="mt-0.5 block w-fit text-xs text-muted-foreground hover:text-foreground"
        >
          <Private>{post.appName ?? post.appId}</Private>
        </Link>
      )}
    </>
  )
}
