import { addDays, toIsoDate, type IsoDate } from '../../lib/dates.js'

/**
 * Meta counts days in Pacific time: a daily value's `end_time` is the next midnight in Los
 * Angeles (07:00 or 08:00 UTC). The dashboard stores it under the Pacific day it covers.
 */

const pacificHour = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles',
  hour: 'numeric',
  hourCycle: 'h23',
})

/** The UTC instant, in Unix seconds, when `day` starts in Los Angeles. */
export function pacificMidnight(day: IsoDate): number {
  // 08:00 UTC is midnight in winter and 01:00 in summer.
  const eight = Date.parse(`${day}T08:00:00Z`)
  const hour = Number(pacificHour.format(eight)) % 24
  return (eight - hour * 3_600_000) / 1000
}

/** Meta writes offsets as `+0000`; this reads them as standard ISO (`+00:00`). */
export function parseMetaTime(value: string): Date {
  return new Date(value.replace(/([+-]\d\d)(\d\d)$/, '$1:$2'))
}

/** The day a daily value covers, from its `end_time` (the midnight that ends it). */
export function dayEndingAt(endTime: string): IsoDate {
  // Half a day back lands safely inside the day, whatever the offset.
  return toIsoDate(new Date(parseMetaTime(endTime).getTime() - 12 * 3_600_000))
}

/** `since` and `until` for a run of whole Pacific days, `from` to `to` inclusive. */
export const pacificWindow = (from: IsoDate, to: IsoDate) => ({
  since: pacificMidnight(from),
  until: pacificMidnight(addDays(to, 1)),
})
