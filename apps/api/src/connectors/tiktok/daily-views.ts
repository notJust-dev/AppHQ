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
 * - `watchStart` is the day the account was connected. Its own views are unknown (there is no
 *   reading from the day before), so values start the day after.
 * - A post that was already up when watching started is a baseline: only its growth counts.
 * - A post published since then counts in full: its first reading is spread over the days from
 *   publishing to that reading.
 * - Days between two readings share the gain evenly, so a missed sync smooths rather than
 *   spikes. A total that drops (TikTok removing views) counts as no gain.
 *
 * Returns one value per day from the day after `watchStart` through `through`, zeros included,
 * so a quiet day shows as zero rather than as missing.
 */
export function dailyViews(params: {
  posts: PostHistory[]
  watchStart: IsoDate
  through: IsoDate
}): Map<IsoDate, number> {
  const { watchStart, through } = params
  const first = addDays(watchStart, 1)
  const totals = new Map<IsoDate, number>()
  if (first > through) return totals
  for (const day of eachDay({ from: first, to: through })) totals.set(day, 0)

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

    // Published since watching started and first read later: everything it has is new.
    if (post.publishedOn >= watchStart && firstReading.date > watchStart) {
      const from = post.publishedOn > first ? post.publishedOn : first
      spread(firstReading.views, from, firstReading.date)
    }

    for (let i = 1; i < readings.length; i++) {
      const previous = readings[i - 1]
      const current = readings[i]
      if (!previous || !current) continue
      spread(current.views - previous.views, addDays(previous.date, 1), current.date)
    }
  }

  for (const [day, value] of totals) totals.set(day, Math.round(value))
  return totals
}
