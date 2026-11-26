import { addDays, eachDay, type IsoDate } from '../../lib/dates.js'

export interface PostHistory {
  /** UTC day the post went up. */
  publishedOn: IsoDate
  /** Lifetime view totals as last read on each day, any order. */
  snapshots: { date: IsoDate; views: number }[]
}

/**
 * Daily views for one account, from its posts' daily lifetime totals. TikTok has no daily
 * series, so a day's views are what every post gained since the day before.
 *
 * - `watchStart` is the day the account was connected. Daily gains start the day after, since
 *   that day has no reading before it.
 * - A post that was already up when watching started (or was first read that day) has its views
 *   at that first reading put on the day it was published, so the account's history before the
 *   connection is not blank. Those days mean "views so far of the videos posted that day", not
 *   views gained that day; only the growth after the first reading counts as daily from then on,
 *   so nothing is counted twice and the total stays exact.
 * - A post published since then counts in full: its first reading is spread over the days from
 *   publishing to that reading.
 * - Days between two readings share the gain evenly, so a missed sync smooths rather than
 *   spikes.
 * - A lifetime total only goes up, so a reading lower than one before it is left out (see
 *   `rising`), and a post that was up before the connection does not start from a reading of
 *   zero (see `baseline`). TikTok answers with zero for a watched video at times; counted as
 *   read, the video's whole lifetime would land on the day the real total came back.
 *
 * Returns one value per day, zeros included, so a quiet day shows as zero rather than as missing:
 * from the day after `watchStart` through `through`, and before that from the first post the
 * account still has. Before the connection a day with no post is zero, as no video posted that
 * day has views to give it.
 */
export function dailyViews(params: {
  posts: PostHistory[]
  watchStart: IsoDate
  through: IsoDate
}): Map<IsoDate, number> {
  const { watchStart, through } = params
  const first = addDays(watchStart, 1)
  const totals = new Map<IsoDate, number>()
  // Connected today: no daily gains yet, but the history before it is already known.
  if (first <= through) {
    for (const day of eachDay({ from: first, to: through })) totals.set(day, 0)
  }

  /** Adds `gain` spread evenly over the days from `from` to `to`, counting both ends. */
  const spread = (gain: number, from: IsoDate, to: IsoDate) => {
    if (gain <= 0 || from > to) return
    const days = eachDay({ from, to })
    const share = gain / days.length
    for (const day of days) {
      const current = totals.get(day)
      if (current !== undefined) totals.set(day, current + share)
    }
  }

  for (const post of params.posts) {
    const read = rising(post.snapshots)
    const readings = post.publishedOn < watchStart ? read.slice(baseline(read)) : read
    const [firstReading] = readings
    if (!firstReading) continue

    if (post.publishedOn >= watchStart && firstReading.date > watchStart) {
      // Published since watching started and first read later: everything it has is new.
      const from = post.publishedOn > first ? post.publishedOn : first
      spread(firstReading.views, from, firstReading.date)
    } else if (post.publishedOn <= through) {
      // Up before watching started: its views so far go on the day it was posted.
      totals.set(post.publishedOn, (totals.get(post.publishedOn) ?? 0) + Math.max(0, firstReading.views))
    }

    for (let i = 1; i < readings.length; i++) {
      const previous = readings[i - 1]
      const current = readings[i]
      if (!previous || !current) continue
      spread(current.views - previous.views, addDays(previous.date, 1), current.date)
    }
  }

  // Zero the days before the connection that had no post, from the first post on, so the history
  // reads as days rather than scattered points.
  const postDays = [...totals.keys()].filter((day) => day < first).sort()
  const [earliest] = postDays
  if (earliest) {
    for (const day of eachDay({ from: earliest, to: watchStart < through ? watchStart : through })) {
      if (!totals.has(day)) totals.set(day, 0)
    }
  }

  for (const [day, value] of totals) totals.set(day, Math.round(value))
  return totals
}

type Reading = PostHistory['snapshots'][number]

/**
 * A post's readings, oldest first, without those lower than one before them. What a post gains
 * is then measured from its highest total so far: a total that dips and comes back adds only
 * what it has above the old one, and the days of a post never add up to more than its highest
 * total. When TikTok really takes views away, the post counts no gain until it is past its old
 * total again.
 */
function rising(snapshots: Reading[]): Reading[] {
  const kept: Reading[] = []
  let highest = Number.NEGATIVE_INFINITY
  for (const reading of [...snapshots].sort((a, b) => a.date.localeCompare(b.date))) {
    if (reading.views < highest) continue
    kept.push(reading)
    highest = reading.views
  }
  return kept
}

/**
 * Where the history of a post that was up before the connection starts: its first reading with
 * views, or its first reading when it has none. A video from before the day of the connection
 * has had time to be watched, so a zero ahead of its real total is taken as not read. The first
 * views of a video that truly had none yet then go on its post day, not the days they came in.
 */
function baseline(readings: Reading[]): number {
  const withViews = readings.findIndex((reading) => reading.views > 0)
  return withViews === -1 ? 0 : withViews
}
