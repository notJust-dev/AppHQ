import { useMutation, useQueryClient, useSuspenseInfiniteQuery, useSuspenseQuery } from '@tanstack/react-query'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { CheckCheck, ExternalLink, MessageSquareText, Star } from 'lucide-react'
import { toast } from 'sonner'
import { z } from 'zod'
import { AppIcon } from '@/components/AppIcon'
import { PageBody, PageHeader } from '@/components/PageHeader'
import { Private } from '@/components/Private'
import { SourceLogo } from '@/components/SourceLogo'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Delta } from '@/components/Delta'
import { markReviewsFn } from '@/fns/reviews'
import { change, formatCount, formatDay } from '@/lib/format'
import {
  appsQuery,
  reviewSummaryQuery,
  reviewsQuery,
  type Review,
  type ReviewFilters,
  type ReviewSummary,
} from '@/lib/queries'
import { sourceLabel } from '@/lib/sources'
import { cn } from '@/lib/utils'

/** The inbox's own filters. The app is the dashboard's `?app=`, the same one as on every page. */
const searchSchema = z.object({
  store: z.enum(['app_store', 'google_play']).optional().catch(undefined),
  rating: z.coerce.number().int().min(1).max(5).optional().catch(undefined),
  unread: z.boolean().optional().catch(undefined),
})

type Search = z.infer<typeof searchSchema> & { app?: string }

const filtersOf = (search: Search): ReviewFilters => ({
  appId: search.app,
  store: search.store,
  rating: search.rating,
  unread: search.unread,
})

export const Route = createFileRoute('/_app/reviews')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) =>
    Promise.all([
      context.queryClient.ensureInfiniteQueryData(reviewsQuery(filtersOf(deps))),
      context.queryClient.ensureQueryData(reviewSummaryQuery({ appId: deps.app, store: deps.store })),
      context.queryClient.ensureQueryData(appsQuery()),
    ]),
  component: ReviewsPage,
})

/** Written App Store and Google Play reviews in one inbox, newest first. */
function ReviewsPage() {
  const search = Route.useSearch()
  const filters = filtersOf(search)
  const reviews = useSuspenseInfiniteQuery(reviewsQuery(filters))
  const { data: summary } = useSuspenseQuery(reviewSummaryQuery({ appId: search.app, store: search.store }))
  const list = reviews.data.pages.flatMap((page) => page.reviews)
  const { data: apps } = useSuspenseQuery(appsQuery())
  const iconOf = (appId: string) => apps.find((app) => app.id === appId)?.iconUrl ?? null
  const mark = useMark()
  const filtered = search.rating !== undefined || search.unread

  return (
    <>
      <PageHeader
        title="Reviews"
        scoped
        description="Written reviews from the App Store and Google Play, newest first. Reviews you have dealt with can be marked read."
        actions={
          summary.unread > 0 && (
            <Button
              variant="outline"
              disabled={mark.isPending}
              onClick={() => mark.mutate({ filters, read: true, all: true })}
            >
              <CheckCheck aria-hidden="true" />
              Mark all as read
            </Button>
          )
        }
      />
      <PageBody>
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0 space-y-4">
            <Filters search={search} />
            {list.length === 0 ? (
              <NoReviews filtered={filtered || summary.total > 0} />
            ) : (
              <ul className="space-y-3">
                {list.map((review) => (
                  <li key={review.id}>
                    <ReviewCard
                      review={review}
                      iconUrl={iconOf(review.appId)}
                      onMark={(read) => mark.mutate({ ids: [review.id], read })}
                      pending={mark.isPending}
                    />
                  </li>
                ))}
              </ul>
            )}
            {reviews.hasNextPage && (
              <div className="flex justify-center">
                <Button variant="outline" disabled={reviews.isFetchingNextPage} onClick={() => void reviews.fetchNextPage()}>
                  {reviews.isFetchingNextPage && <Spinner />}
                  Show older reviews
                </Button>
              </div>
            )}
          </div>
          <SummaryCard summary={summary} />
        </div>
      </PageBody>
    </>
  )
}

/** Marking reviews read or unread, then refreshing the inbox and the sidebar's count. */
function useMark() {
  const markReviews = useServerFn(markReviewsFn)
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { ids?: string[]; filters?: ReviewFilters; read: boolean; all?: boolean }) =>
      markReviews({ data: { ids: input.ids, filters: input.filters, read: input.read } }),
    onSuccess: async (result, input) => {
      if (input.all) toast.success(result.changed === 1 ? 'Marked 1 review as read.' : `Marked ${result.changed} reviews as read.`)
      await queryClient.invalidateQueries({ queryKey: ['reviews'] })
    },
    onError: () => toast.error('Could not save that. Try again.'),
  })
}

/** The select's value for "no filter"; Radix keeps the empty string for its placeholder. */
const ANY = 'any'

/** The inbox's own filters; the app is chosen in the top bar, as on every page. */
function Filters({ search }: { search: Search }) {
  const navigate = useNavigate()
  const set = (patch: Partial<Search>) =>
    void navigate({ to: '/reviews', search: (previous) => ({ ...previous, ...patch }) })

  return (
    <div className="flex flex-wrap gap-2">
      <Select
        value={search.store ?? ANY}
        onValueChange={(value) => set({ store: value === ANY ? undefined : (value as Search['store']) })}
      >
        <SelectTrigger aria-label="Store" className="w-40 bg-card">
          <SelectValue>
            {search.store ? (
              <>
                <SourceLogo source={search.store} decorative />
                {sourceLabel(search.store)}
              </>
            ) : (
              'Both stores'
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>Both stores</SelectItem>
          {(['app_store', 'google_play'] as const).map((store) => (
            <SelectItem key={store} value={store}>
              <SourceLogo source={store} decorative />
              {sourceLabel(store)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={search.rating ? String(search.rating) : ANY}
        onValueChange={(value) => set({ rating: value === ANY ? undefined : Number(value) })}
      >
        <SelectTrigger aria-label="Rating" className="w-36 bg-card">
          <SelectValue>{search.rating ? `${search.rating} ${search.rating === 1 ? 'star' : 'stars'}` : 'Any rating'}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>Any rating</SelectItem>
          {[5, 4, 3, 2, 1].map((stars) => (
            <SelectItem key={stars} value={String(stars)}>
              {stars} {stars === 1 ? 'star' : 'stars'}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={search.unread ? 'unread' : ANY} onValueChange={(value) => set({ unread: value === 'unread' ? true : undefined })}>
        <SelectTrigger aria-label="Read state" className="w-44 bg-card">
          <SelectValue>{search.unread ? 'Unread' : 'Read and unread'}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>Read and unread</SelectItem>
          <SelectItem value="unread">Unread</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}

/** A star rating, drawn and said. */
function Stars({ rating, className }: { rating: number; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-0.5', className)} role="img" aria-label={`${rating} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((index) => (
        <Star
          key={index}
          aria-hidden="true"
          className={cn('size-3.5', index <= rating ? 'fill-current text-foreground' : 'text-faint')}
        />
      ))}
    </span>
  )
}

function ReviewCard(props: {
  review: Review
  iconUrl: string | null
  onMark: (read: boolean) => void
  pending: boolean
}) {
  const { review, onMark, pending } = props
  const place = review.territory ?? review.language
  return (
    <Card className={cn('gap-3 px-5 py-4', !review.read && 'ring-foreground/25')}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <span className="flex items-center gap-2">
          <Stars rating={review.rating} />
          {!review.read && <Badge variant="secondary">Unread</Badge>}
        </span>
        <time dateTime={review.createdAt} className="text-xs text-muted-foreground">
          {formatDay(review.createdAt.slice(0, 10))}
        </time>
      </div>
      {/* Reviews often name the app, so privacy mode blurs their words; the stars stay. */}
      <div className="space-y-1">
        {review.title && (
          <h2 data-private="" className="font-medium">
            {review.title}
          </h2>
        )}
        {review.body && (
          <p data-private="" className="whitespace-pre-line text-pretty">
            {review.body}
          </p>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        <AppIcon
          app={{ name: review.appName, iconUrl: props.iconUrl }}
          className="mr-1.5 inline-grid size-4 align-[-0.25rem] text-[9px]"
        />
        <Link to="." search={(previous) => ({ ...previous, app: review.appId })} className="font-medium text-foreground hover:underline">
          <Private>{review.appName}</Private>
        </Link>
        {' · '}
        <SourceLogo source={review.store} />
        {[place, review.appVersion && `version ${review.appVersion}`]
          .filter(Boolean)
          .map((part) => ` · ${part}`)
          .join('')}
        {review.author && (
          <>
            {' · '}
            <Private>{review.author}</Private>
          </>
        )}
        {review.device && ` · ${review.device}`}
        {review.editedAt && review.editedAt.slice(0, 10) !== review.createdAt.slice(0, 10) && ` · edited ${formatDay(review.editedAt.slice(0, 10))}`}
      </p>
      {review.reply && (
        <div className="rounded-lg bg-muted/60 px-3 py-2 text-sm">
          <p className="text-xs font-medium text-muted-foreground">
            Your reply{review.repliedAt ? `, ${formatDay(review.repliedAt.slice(0, 10))}` : ''}
          </p>
          <p data-private="" className="mt-0.5 whitespace-pre-line">
            {review.reply}
          </p>
        </div>
      )}
      <div className="-mx-2 -mb-1 flex flex-wrap gap-1">
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => onMark(!review.read)}>
          {review.read ? 'Mark as unread' : 'Mark as read'}
        </Button>
        {review.url && (
          <Button asChild variant="ghost" size="sm">
            <a href={review.url} target="_blank" rel="noreferrer">
              {review.reply ? 'Open in Play Console' : 'Reply in Play Console'}
              <ExternalLink aria-hidden="true" />
            </a>
          </Button>
        )}
      </div>
    </Card>
  )
}

/** The rating overall, how the stars spread, and the last month against the one before. */
function SummaryCard({ summary }: { summary: ReviewSummary }) {
  const most = Math.max(1, ...summary.distribution.map((row) => row.count))
  return (
    <Card className="gap-4 px-5 py-4 lg:sticky lg:top-16">
      <div>
        <p className="text-xs font-medium text-muted-foreground">Average rating</p>
        <p className="mt-1 flex items-baseline gap-2">
          <span className="figures text-3xl leading-none font-semibold tracking-tight">
            {summary.average === null ? '–' : summary.average.toFixed(1)}
          </span>
          {summary.average !== null && <Stars rating={Math.round(summary.average)} />}
        </p>
        <p className="mt-1.5 text-xs text-muted-foreground">
          From {formatCount(summary.total)} written {summary.total === 1 ? 'review' : 'reviews'}
          {summary.unread > 0 && `, ${formatCount(summary.unread)} unread`}
        </p>
      </div>
      <ol className="space-y-1.5" aria-label="Reviews by rating">
        {summary.distribution.map((row) => (
          <li key={row.rating} className="flex items-center gap-2 text-xs">
            <span className="w-3 text-right text-muted-foreground">{row.rating}</span>
            <Star aria-hidden="true" className="size-3 fill-current text-muted-foreground" />
            <span className="h-2 flex-1 rounded-full bg-muted" aria-hidden="true">
              <span
                className="block h-full rounded-full bg-foreground/70"
                style={{ width: `${row.count === 0 ? 0 : Math.max(3, (row.count / most) * 100)}%` }}
              />
            </span>
            <span className="figures w-8 text-right">{formatCount(row.count)}</span>
            <span className="sr-only">{row.rating === 1 ? 'star' : 'stars'}</span>
          </li>
        ))}
      </ol>
      <div className="border-t pt-3 text-sm">
        <p className="text-xs font-medium text-muted-foreground">Last {summary.recentDays} days</p>
        <p className="mt-1">
          <span className="figures font-medium">{formatCount(summary.recent.count)}</span>{' '}
          {summary.recent.count === 1 ? 'review' : 'reviews'}
          {summary.recent.average !== null && (
            <>
              , averaging <span className="figures font-medium">{summary.recent.average.toFixed(1)}</span>
            </>
          )}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {summary.previous.count > 0 ? (
            <>
              <Delta change={change(summary.recent.count, summary.previous.count)} better="neither" /> reviews vs the {summary.recentDays} days before
              {summary.previous.average !== null && `, which averaged ${summary.previous.average.toFixed(1)}`}
            </>
          ) : (
            `None in the ${summary.recentDays} days before`
          )}
        </p>
      </div>
    </Card>
  )
}

function NoReviews({ filtered }: { filtered: boolean }) {
  return (
    <Empty className="border border-dashed bg-card">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <MessageSquareText />
        </EmptyMedia>
        <EmptyTitle>{filtered ? 'No reviews match' : 'No reviews yet'}</EmptyTitle>
        <EmptyDescription>
          {filtered ? (
            'Try another app, store, rating or read state.'
          ) : (
            <>
              Reviews arrive with each sync from App Store Connect and Google Play, for the apps you track. Connect
              them on the <Link to="/settings/integrations">Accounts page</Link>.
            </>
          )}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}
