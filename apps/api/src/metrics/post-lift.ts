import { addDays, eachDay, type IsoDate } from '../lib/dates.js'

/** Days counted from the post's own day: the day it went up and the two after. */
export const LIFT_DAYS = 3
/** Days before the post that set what "normal" looks like. */
export const BASELINE_DAYS = 7
/** A baseline needs at least this many of its days to have data. */
const MIN_BASELINE_DAYS = 4

export type DownloadLift =
  | {
      status: 'ok'
      /** Downloads over the post's day and the two after. */
      downloads: number
      /** What those days would have brought at the week before's daily average. */
      expected: number
      change: number
      /** change / expected; null when nothing was expected. */
      changeRatio: number | null
    }
  /** The three days are not all reported yet. */
  | { status: 'too_recent' }
  /** Too few days with downloads in the week before to say what normal is. */
  | { status: 'no_baseline' }
  /** No downloads reported around the post at all. */
  | { status: 'no_downloads' }

/**
 * Downloads in the days after a post, against the days before. It is a comparison with a
 * baseline, not attribution: anything else that happened in those days counts too, and posts
 * that go up close together share the same days.
 */
export function downloadLift(
  downloadsByDay: ReadonlyMap<IsoDate, number>,
  publishedOn: IsoDate,
  lastReportedDay: IsoDate | null,
): DownloadLift {
  if (lastReportedDay === null) return { status: 'no_downloads' }
  const windowEnd = addDays(publishedOn, LIFT_DAYS - 1)
  if (windowEnd > lastReportedDay) return { status: 'too_recent' }

  const after = eachDay({ from: publishedOn, to: windowEnd }).map((day) => downloadsByDay.get(day))
  if (after.some((value) => value === undefined)) return { status: 'no_downloads' }

  const before = eachDay({ from: addDays(publishedOn, -BASELINE_DAYS), to: addDays(publishedOn, -1) })
    .map((day) => downloadsByDay.get(day))
    .filter((value): value is number => value !== undefined)
  if (before.length < MIN_BASELINE_DAYS) return { status: 'no_baseline' }

  const downloads = after.reduce<number>((sum, value) => sum + (value ?? 0), 0)
  const expected = (before.reduce((sum, value) => sum + value, 0) / before.length) * LIFT_DAYS
  const change = downloads - expected
  return {
    status: 'ok',
    downloads,
    expected: Math.round(expected),
    change: Math.round(change),
    changeRatio: expected > 0 ? Math.round((change / expected) * 1000) / 1000 : null,
  }
}
