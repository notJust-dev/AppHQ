import { useState, type FocusEvent, type KeyboardEvent, type PointerEvent } from 'react'
import { formatCount, formatDay, formatTick, formatValue } from '@/lib/format'
import { liftSentence } from '@/lib/lift'
import type { Post, Timeline as TimelineData } from '@/lib/queries'
import { niceScale, tickIndexes } from '@/lib/scale'
import { sourceLabel } from '@/lib/sources'

type Series = TimelineData['series'][number]
type Values = Series['values']

/** The posts that went up on one day of the range. */
interface PostDay {
  index: number
  day: string
  posts: Post[]
  views: number
}

/** The days a selected post's lift is measured over: its own day and the two after. */
interface Band {
  from: number
  to: number
}

const LIFT_DAYS = 3

function groupByDay(posts: Post[], days: string[]): PostDay[] {
  const dayIndex = new Map(days.map((day, index) => [day, index]))
  const groups = new Map<number, PostDay>()
  for (const post of posts) {
    const day = post.publishedAt.slice(0, 10)
    const index = dayIndex.get(day)
    if (index === undefined) continue
    const group = groups.get(index) ?? { index, day, posts: [], views: 0 }
    group.posts.push(post)
    group.views += post.views
    groups.set(index, group)
  }
  return [...groups.values()].sort((a, b) => a.index - b.index)
}

/**
 * One app's funnel, one row per step on a shared date axis. Each row has its own scale (the
 * steps are counted in different units and differ by orders of magnitude), and one crosshair
 * reads the same day across every row, which is how a spike in views is compared with what
 * downloads and revenue did around it.
 */

const STAGE = {
  views: { stroke: 'var(--views)', swatch: 'bg-views' },
  downloads: { stroke: 'var(--downloads)', swatch: 'bg-downloads' },
  revenue: { stroke: 'var(--revenue)', swatch: 'bg-revenue' },
} as const

/** Where each row's numbers come from, for a row whose sources have sent nothing at all. */
const WHERE_FROM: Record<string, string> = {
  socialViews: 'Comes from TikTok, Instagram, Facebook and YouTube. Link an account in Settings.',
  pageViews: 'Comes from App Store and Google Play analytics, which are not connected yet.',
  downloads: 'Comes from the App Store and Google Play. Link an iOS or Android app in Settings.',
  trials: 'Comes from RevenueCat. Link a project in Settings.',
  revenue: 'Comes from RevenueCat. Link a project in Settings.',
  mrr: 'Comes from RevenueCat. Link a project in Settings.',
}

/**
 * Why a row is empty. If one of its sources reported other rows for this app, the source is
 * connected and simply had nothing for this one in the range; otherwise it is not connected.
 */
function emptyReason(
  series: Series,
  reporting: ReadonlySet<string>,
  connected: ReadonlySet<string>,
): string {
  // `from` can be missing for a moment during a deploy, when the dashboard is newer than the API.
  const from = series.from ?? []
  const reported = from.filter((source) => reporting.has(source))
  // The App Store sends downloads from one report and page views from another, which Apple
  // only makes once asked; its downloads say nothing about whether page views have started.
  if (series.key === 'pageViews' && reported.length === 1 && reported[0] === 'app_store') {
    return "App Store page views come from Apple's analytics reports, which start a day or two after an app is added and need an Admin key once. See App Store Connect on the Accounts page."
  }
  if (reported.length > 0) return `${reported.map(sourceLabel).join(' and ')} reported none in this range.`
  const linked = from.filter((source) => connected.has(source))
  if (linked.includes('tiktok')) {
    return 'TikTok is connected. Daily views start the day after connecting, once there are two readings to compare.'
  }
  if (linked.length > 0) return `${linked.map(sourceLabel).join(' and ')} connected, with nothing reported in this range yet.`
  return WHERE_FROM[series.key] ?? 'Not connected yet.'
}

// The plot is drawn in a fixed coordinate space and stretched to fit, with strokes that do not
// scale; text and dots are HTML positioned in percent, so nothing is distorted.
const VIEW_W = 1000
const VIEW_H = 100

/** Plot margins, shared by every row and the date axis so the days line up. The left one holds the y-axis labels. */
const PLOT_INSET = 'mr-6 ml-16'

const lastIndexOf = (values: Values) => values.findLastIndex((value) => value !== null)

export function Timeline({
  days,
  series,
  posts = [],
  connected = new Set(),
}: {
  days: string[]
  series: Series[]
  /** Posts published in the range, shown as markers above the rows. */
  posts?: Post[]
  /** Providers with an account connected to this app, so an empty row can say why it is empty. */
  connected?: ReadonlySet<string>
}) {
  const [active, setActive] = useState<number | null>(null)
  const [showTable, setShowTable] = useState(false)
  // Kept as a day rather than an index, so a different range cannot point it at another day.
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const count = days.length
  const percent = (index: number) => (count <= 1 ? 50 : (index / (count - 1)) * 100)

  const postDays = groupByDay(posts, days)
  const selected = postDays.find((group) => group.day === selectedDay) ?? null
  const band: Band | null = selected
    ? { from: selected.index, to: Math.min(selected.index + LIFT_DAYS - 1, count - 1) }
    : null

  const pointAt = (event: PointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const ratio = (event.clientX - rect.left) / rect.width
    setActive(Math.min(count - 1, Math.max(0, Math.round(ratio * (count - 1)))))
  }

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const last = count - 1
    const current = active ?? last
    const next =
      event.key === 'ArrowLeft'
        ? Math.max(0, current - 1)
        : event.key === 'ArrowRight'
          ? Math.min(last, current + 1)
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : undefined
    if (event.key === 'Escape') setActive(null)
    if (next === undefined) return
    event.preventDefault()
    setActive(next)
  }

  const withData = series.filter((entry) => entry.sources.length > 0)
  const reporting = new Set(withData.flatMap((entry) => entry.sources.map((part) => part.source)))
  const readout =
    active === null
      ? ''
      : `${formatDay(days[active] ?? '')}. ${withData
          .map((entry) => {
            const value = entry.values[active]
            return `${entry.label}: ${value === null || value === undefined ? 'no data' : formatValue(value, entry.unit)}`
          })
          .join('. ')}.`

  return (
    <figure>
      <div
        role="group"
        tabIndex={0}
        aria-label="Daily funnel. Use the left and right arrow keys to read one day across every row."
        onKeyDown={onKeyDown}
        onFocus={() => setActive((current) => current ?? count - 1)}
        onBlur={() => setActive(null)}
        onPointerLeave={() => setActive(null)}
        className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10 outline-offset-4"
      >
        {postDays.length > 0 && (
          <PostsLane
            groups={postDays}
            total={posts.length}
            active={active}
            band={band}
            selectedDay={selected?.day ?? null}
            percent={percent}
            onPoint={pointAt}
            onFocusDay={setActive}
            onSelect={(day) => setSelectedDay((current) => (current === day ? null : day))}
          />
        )}
        {series.map((entry) => (
          <Track
            key={entry.key}
            series={entry}
            days={days}
            active={active}
            band={band}
            percent={percent}
            onPoint={pointAt}
            reporting={reporting}
            connected={connected}
          />
        ))}
        <DateAxis days={days} percent={percent} />
      </div>

      <div aria-live="polite" className="sr-only">
        {readout}
      </div>

      {selected && <PostDetail group={selected} onClose={() => setSelectedDay(null)} />}

      <figcaption className="mt-3 flex flex-wrap items-baseline justify-between gap-3 text-sm text-muted-foreground">
        <span>
          Each row has its own scale. Point at a day, or focus the chart and use the arrow keys,
          to read that day across every row.
          {postDays.length > 0 && ' Select a post to shade the three days its lift is measured over.'}
        </span>
        <button
          type="button"
          onClick={() => setShowTable((shown) => !shown)}
          aria-expanded={showTable}
          className="cursor-pointer font-medium text-foreground underline underline-offset-4"
        >
          {showTable ? 'Hide the numbers' : 'Show the numbers as a table'}
        </button>
      </figcaption>

      {showTable && <TimelineTable days={days} series={withData} />}
    </figure>
  )
}

/**
 * One marker per day with posts, sized by their views (by area, so a post with four times the
 * views has a dot twice as wide). Hovering or focusing a marker shows its post; selecting it
 * shades the days its download lift covers in every row.
 *
 * Dots on neighbouring days overlap, so the pointer picks the nearest marker rather than
 * whichever was drawn last. The markers are still buttons, for the keyboard and screen readers.
 */
function PostsLane(props: {
  groups: PostDay[]
  total: number
  active: number | null
  band: Band | null
  selectedDay: string | null
  percent: (index: number) => number
  onPoint: (event: PointerEvent<HTMLElement>) => void
  onFocusDay: (index: number) => void
  onSelect: (day: string) => void
}) {
  const { groups, percent } = props
  const most = Math.max(1, ...groups.map((group) => group.views))
  const diameter = (views: number) => 8 + 12 * Math.sqrt(views / most)
  // The tooltip describes the marker nearest the pointer, or else the focused one. They are
  // kept apart so moving the mouse never takes the tooltip away from keyboard focus.
  const [hoverDay, setHoverDay] = useState<string | null>(null)
  const [focusDay, setFocusDay] = useState<string | null>(null)
  const tip = groups.find((group) => group.day === (hoverDay ?? focusDay)) ?? null

  /** The marker nearest to `clientX`, when one is within reach of it. */
  const nearest = (plot: HTMLElement, clientX: number): PostDay | null => {
    const rect = plot.getBoundingClientRect()
    const x = clientX - rect.left
    let best: PostDay | null = null
    let bestDistance = Number.POSITIVE_INFINITY
    for (const group of groups) {
      const distance = Math.abs((percent(group.index) / 100) * rect.width - x)
      if (distance < bestDistance) {
        best = group
        bestDistance = distance
      }
    }
    return best && bestDistance <= Math.max(12, diameter(best.views) / 2 + 6) ? best : null
  }
  const track = (event: PointerEvent<HTMLElement>) => {
    props.onPoint(event)
    setHoverDay(nearest(event.currentTarget, event.clientX)?.day ?? null)
  }
  const tipLeft = tip ? percent(tip.index) : 0
  // Near the edges the tooltip hangs inwards, so it is never cut off.
  const tipAlign = tipLeft < 20 ? '' : tipLeft > 80 ? '-translate-x-full' : '-translate-x-1/2'

  return (
    <div className="border-b border-border md:grid md:grid-cols-[13rem_1fr]">
      <div className="px-6 pt-4 md:py-4">
        <p className="flex items-center gap-2 text-sm font-medium">
          <span className="size-2.5 rounded-full bg-views" aria-hidden="true" />
          Posts
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {props.total} in this range. Dot size shows views.
        </p>
      </div>
      <div
        onPointerMove={track}
        onPointerDown={track}
        onPointerLeave={() => setHoverDay(null)}
        onClick={(event) => {
          const group = nearest(event.currentTarget, event.clientX)
          if (group) props.onSelect(group.day)
        }}
        className={`relative mt-2 mb-3 h-12 touch-pan-y md:my-3 ${PLOT_INSET} ${tip ? 'cursor-pointer' : ''}`}
      >
        <BandShade band={props.band} percent={percent} />
        {props.active !== null && (
          <span
            className="pointer-events-none absolute inset-y-0 w-px bg-foreground/40"
            style={{ left: `${percent(props.active)}%` }}
            aria-hidden="true"
          />
        )}
        {groups.map((group) => {
          const size = diameter(group.views)
          const left = percent(group.index)
          const isSelected = group.day === props.selectedDay
          const first = group.posts[0]
          const label =
            `${formatDay(group.day)}: ` +
            (group.posts.length === 1
              ? `${sourceLabel(first?.platform ?? '')} post, ${formatCount(group.views)} views`
              : `${group.posts.length} posts, ${formatCount(group.views)} views`)

          return (
            <button
              key={group.day}
              type="button"
              aria-label={label}
              aria-pressed={isSelected}
              aria-controls={isSelected ? 'post-detail' : undefined}
              onClick={(event) => {
                // Only the keyboard reaches here (the pointer goes to the lane); keep the lane
                // from handling the same click again.
                event.stopPropagation()
                props.onSelect(group.day)
              }}
              onFocus={(event: FocusEvent<HTMLButtonElement>) => {
                // The chart's own focus handler would move the crosshair to the last day.
                event.stopPropagation()
                props.onFocusDay(group.index)
                setFocusDay(group.day)
              }}
              onBlur={() => setFocusDay(null)}
              className="pointer-events-none absolute top-1/2 grid -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full outline-offset-2"
              style={{ left: `${left}%`, width: Math.max(24, size + 8), height: Math.max(24, size + 8) }}
            >
              <span
                className={`block rounded-full bg-views ring-2 transition-transform ${
                  isSelected ? 'ring-foreground' : 'ring-card'
                } ${tip?.day === group.day ? 'scale-110' : ''}`}
                style={{ width: size, height: size }}
                aria-hidden="true"
              />
            </button>
          )
        })}

        {tip && (
          <span
            className={`pointer-events-none absolute top-full z-20 mt-1 w-60 rounded-lg bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md ring-1 ring-foreground/10 ${tipAlign}`}
            style={{ left: `${tipLeft}%` }}
            aria-hidden="true"
          >
            <span className="figures block font-semibold text-foreground">
              {formatCount(tip.views)} views
            </span>
            <span className="block text-muted-foreground">
              {formatDay(tip.day)}
              {tip.posts.length > 1
                ? `, ${tip.posts.length} posts`
                : `, ${sourceLabel(tip.posts[0]?.platform ?? '')}`}
            </span>
            {tip.posts[0]?.caption && (
              <span className="mt-1 line-clamp-2 block text-foreground">{tip.posts[0].caption}</span>
            )}
          </span>
        )}
      </div>
    </div>
  )
}

/** The lift window, shaded behind a row's plot. */
function BandShade({ band, percent }: { band: Band | null; percent: (index: number) => number }) {
  if (!band) return null
  const left = percent(band.from)
  return (
    <span
      className="pointer-events-none absolute inset-y-0 border-l border-views bg-views/10"
      style={{ left: `${left}%`, width: `max(2px, ${percent(band.to) - left}%)` }}
      aria-hidden="true"
    />
  )
}

/** The selected day's posts, their totals, and the download lift around them. */
function PostDetail({ group, onClose }: { group: PostDay; onClose: () => void }) {
  const lift = group.posts[0]?.downloadLift
  return (
    <section
      id="post-detail"
      aria-label={`Posts on ${formatDay(group.day)}`}
      className="mt-4 rounded-xl bg-card ring-1 ring-foreground/10 px-6 py-5"
    >
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          Posted {formatDay(group.day)}
          {group.posts.length > 1 && `, ${group.posts.length} posts`}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="cursor-pointer text-sm font-medium text-foreground underline underline-offset-4"
        >
          Close
        </button>
      </div>
      <ul className="mt-2 space-y-3">
        {group.posts.map((post) => (
          <li key={post.id}>
            <p className="font-medium">
              {post.url ? (
                <a
                  href={post.url}
                  target="_blank"
                  rel="noreferrer"
                  className="underline decoration-border underline-offset-4 hover:decoration-foreground"
                >
                  {post.caption || 'Untitled post'}
                </a>
              ) : (
                post.caption || 'Untitled post'
              )}
            </p>
            <p className="figures mt-1 text-sm text-muted-foreground">
              {sourceLabel(post.platform)} · {formatCount(post.views)} views ·{' '}
              {formatCount(post.likes)} likes · {formatCount(post.comments)} comments ·{' '}
              {formatCount(post.shares)} shares
            </p>
          </li>
        ))}
      </ul>
      {lift && (
        <p className="mt-4 border-t border-border pt-4 text-sm">
          <span className="font-medium">Download lift. </span>
          {liftSentence(lift, group.day)}{' '}
          <span className="text-muted-foreground">
            Lift is measured against a baseline; it does not prove the post caused it.
          </span>
        </p>
      )}
    </section>
  )
}

function Track(props: {
  series: Series
  days: string[]
  active: number | null
  band: Band | null
  percent: (index: number) => number
  onPoint: (event: PointerEvent<HTMLElement>) => void
  /** Sources that reported anything for this app in the range. */
  reporting: ReadonlySet<string>
  connected: ReadonlySet<string>
}) {
  const { series, days, active, percent } = props
  const stage = STAGE[series.stage]
  const empty = series.sources.length === 0

  const present = series.values.filter((value): value is number => value !== null)
  const scale = niceScale(Math.max(0, ...present), { integer: series.unit === 'count' })
  const low = Math.min(0, ...present)
  const y = (value: number) => VIEW_H - ((value - low) / (scale.max - low)) * VIEW_H
  const yPercent = (value: number) => (y(value) / VIEW_H) * 100

  const lastIndex = lastIndexOf(series.values)
  const shownIndex = active ?? (lastIndex >= 0 ? lastIndex : null)
  const shownValue = shownIndex === null ? null : (series.values[shownIndex] ?? null)
  const headline = active === null ? series.summary : (series.values[active] ?? null)

  // Stores report with different delays; the total stops where the slowest one has got to.
  // `?? null` covers a dashboard briefly newer than the API during a deploy.
  const completeThrough = series.completeThrough ?? null
  const waiting = (series.waitingFor ?? []).map(sourceLabel).join(' and ')
  const caption =
    active !== null
      ? `${formatDay(days[active] ?? '')}${
          completeThrough !== null && (days[active] ?? '') > completeThrough
            ? `, waiting for ${waiting}`
            : series.values[active] === null
              ? ', no data'
              : ''
        }`
      : series.aggregate === 'last' && lastIndex >= 0
        ? `Latest, ${formatDay(days[lastIndex] ?? '')}`
        : completeThrough !== null
          ? `Total through ${formatDay(completeThrough)}, waiting for ${waiting}`
          : `Total over ${days.length} days`

  return (
    <div className="border-b border-border md:grid md:grid-cols-[13rem_1fr]">
      <div className="px-6 pt-4 md:py-4">
        <p className="flex items-center gap-2 text-sm font-medium">
          <span className={`size-2.5 rounded-[3px] ${stage.swatch}`} aria-hidden="true" />
          {series.label}
        </p>
        {empty ? (
          <p className="mt-1 text-sm text-muted-foreground">No data yet</p>
        ) : (
          <>
            <p className="figures mt-1 text-2xl font-semibold tracking-tight">
              {headline === null ? '–' : formatValue(headline, series.unit)}
            </p>
            <p className="text-xs text-muted-foreground">{caption}</p>
            {series.sources.length > 1 && (
              <dl className="mt-2 grid grid-cols-[auto_auto] justify-start gap-x-4 text-xs">
                {series.sources.map((source) => {
                  const value = active === null ? source.summary : source.values[active]
                  return (
                    <div key={source.source} className="contents">
                      <dt className="text-muted-foreground">{sourceLabel(source.source)}</dt>
                      <dd className="figures text-right">
                        {value === null || value === undefined ? '–' : formatValue(value, series.unit)}
                      </dd>
                    </div>
                  )
                })}
              </dl>
            )}
          </>
        )}
      </div>

      {empty ? (
        <p className="px-6 pt-1 pb-4 text-sm text-muted-foreground md:self-center md:py-4">
          {emptyReason(series, props.reporting, props.connected)}
        </p>
      ) : (
        <div
          onPointerMove={props.onPoint}
          onPointerDown={props.onPoint}
          className={`relative mt-5 mb-4 h-20 touch-pan-y md:mt-6 ${PLOT_INSET}`}
        >
          <BandShade band={props.band} percent={percent} />
          <svg
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            preserveAspectRatio="none"
            className="absolute inset-0 size-full overflow-visible"
            aria-hidden="true"
          >
            {scale.ticks.map((tick) => (
              <line
                key={tick}
                x1={0}
                x2={VIEW_W}
                y1={y(tick)}
                y2={y(tick)}
                stroke="var(--border)"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            <path d={areaPath(series.values, y(0), y, days.length)} fill={stage.stroke} fillOpacity={0.1} />
            <path
              d={linePath(series.values, y, days.length)}
              fill="none"
              stroke={stage.stroke}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>

          {scale.ticks.map((tick) => (
            <span
              key={tick}
              className="figures pointer-events-none absolute right-full mr-2 -translate-y-1/2 text-[11px] leading-none whitespace-nowrap text-muted-foreground"
              style={{ top: `${yPercent(tick)}%` }}
            >
              {formatTick(tick, series.unit)}
            </span>
          ))}

          {active !== null && (
            <span
              className="pointer-events-none absolute inset-y-0 w-px bg-foreground/40"
              style={{ left: `${percent(active)}%` }}
              aria-hidden="true"
            />
          )}

          {shownIndex !== null && shownValue !== null && (
            <span
              className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card"
              style={{
                left: `${percent(shownIndex)}%`,
                top: `${yPercent(shownValue)}%`,
                backgroundColor: stage.stroke,
              }}
              aria-hidden="true"
            />
          )}
        </div>
      )}
    </div>
  )
}

function DateAxis({ days, percent }: { days: string[]; percent: (index: number) => number }) {
  const indexes = tickIndexes(days.length)
  const last = days.length - 1
  return (
    <div className="md:grid md:grid-cols-[13rem_1fr]" aria-hidden="true">
      <div className="hidden md:block" />
      <div className={`relative h-9 ${PLOT_INSET}`}>
        {indexes.map((index) => (
          <span
            key={index}
            className={`figures absolute top-2.5 text-xs whitespace-nowrap text-muted-foreground ${
              index === 0 ? '' : index === last ? '-translate-x-full' : '-translate-x-1/2'
            }`}
            style={{ left: `${percent(index)}%` }}
          >
            {formatDay(days[index] ?? '')}
          </span>
        ))}
      </div>
    </div>
  )
}

function TimelineTable({ days, series }: { days: string[]; series: Series[] }) {
  // Newest first: the recent days are the ones people look up.
  const order = days.map((_, index) => index).reverse()
  return (
    <div className="mt-4 max-h-[28rem] overflow-auto rounded-xl bg-card ring-1 ring-foreground/10">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <caption className="sr-only">Daily values for every funnel step</caption>
        <thead className="sticky top-0 bg-card">
          <tr className="border-b border-border text-muted-foreground">
            <th scope="col" className="px-6 py-3 text-left font-medium">
              Day
            </th>
            {series.map((entry) => (
              <th key={entry.key} scope="col" className="px-6 py-3 text-right font-medium">
                {entry.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {order.map((index) => (
            <tr key={days[index]} className="border-b border-border last:border-b-0">
              <th scope="row" className="px-6 py-2 text-left font-normal whitespace-nowrap">
                {formatDay(days[index] ?? '')}
              </th>
              {series.map((entry) => {
                const value = entry.values[index]
                return (
                  <td key={entry.key} className="figures px-6 py-2 text-right">
                    {value === null || value === undefined ? '–' : formatValue(value, entry.unit)}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Runs of consecutive days that have a value, as [index, value] pairs. */
function runs(values: Values): [number, number][][] {
  const result: [number, number][][] = []
  let current: [number, number][] = []
  values.forEach((value, index) => {
    if (value === null) {
      if (current.length > 0) result.push(current)
      current = []
    } else {
      current.push([index, value])
    }
  })
  if (current.length > 0) result.push(current)
  return result
}

const xAt = (index: number, count: number) => (count <= 1 ? VIEW_W / 2 : (index / (count - 1)) * VIEW_W)

function linePath(values: Values, y: (value: number) => number, count: number): string {
  return runs(values)
    .map((run) => {
      const [first, ...rest] = run
      if (!first) return ''
      const start = `M${xAt(first[0], count)},${y(first[1])}`
      // A lone day still gets a visible mark: a zero-length segment with a round cap.
      if (rest.length === 0) return `${start}h0.01`
      return start + rest.map(([index, value]) => `L${xAt(index, count)},${y(value)}`).join('')
    })
    .join('')
}

function areaPath(values: Values, base: number, y: (value: number) => number, count: number): string {
  return runs(values)
    .filter((run) => run.length > 1)
    .map((run) => {
      const first = run[0]
      const last = run[run.length - 1]
      if (!first || !last) return ''
      const top = run.map(([index, value]) => `L${xAt(index, count)},${y(value)}`).join('')
      return `M${xAt(first[0], count)},${base}${top}L${xAt(last[0], count)},${base}Z`
    })
    .join('')
}
