import { addDays, type IsoDate } from '../lib/dates.js'

/** A source that is this many days behind the newest one counts as stopped, not late. */
export const LATE_TOLERANCE_DAYS = 10

/**
 * The last day every source still reporting has reached, and the sources the days after it
 * are waiting for. Sources lag by different amounts (RevenueCat is live, the App Store a day
 * behind, Google Play up to a week), so a total past that day would be missing the slow ones and
 * look like a drop. A source more than LATE_TOLERANCE_DAYS behind the newest has stopped (its
 * account was disconnected, say) and does not hold the others back.
 */
export function lastCompleteDay(lastDays: ReadonlyMap<string, IsoDate>): {
  through: IsoDate | null
  waitingFor: string[]
} {
  const entries = [...lastDays]
  if (entries.length === 0) return { through: null, waitingFor: [] }
  const newest = entries.reduce((max, [, day]) => (day > max ? day : max), entries[0]?.[1] ?? '')
  const cutoff = addDays(newest, -LATE_TOLERANCE_DAYS)
  const active = entries.filter(([, day]) => day >= cutoff)
  const through = active.reduce((min, [, day]) => (day < min ? day : min), newest)
  const waitingFor = active.filter(([, day]) => day < newest).map(([source]) => source).sort()
  return { through, waitingFor }
}
