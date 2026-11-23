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
 *   spikes. A total that drops (TikTok removing views) counts as no gain.
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
    const readings = [...post.snapshots].sort((a, b) => a.date.localeCompare(b.date))
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
