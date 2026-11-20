/** Calendar days travel through the API as 'YYYY-MM-DD' strings, always UTC. */
export type IsoDate = string

export interface DateRange {
  /** Inclusive. */
  from: IsoDate
  /** Inclusive. */
  to: IsoDate
}

const DAY_MS = 86_400_000

export function toIsoDate(d: Date): IsoDate {
  return d.toISOString().slice(0, 10)
}

export function parseIsoDate(s: IsoDate): Date {
  return new Date(`${s}T00:00:00.000Z`)
}

export function todayUtc(now: Date = new Date()): IsoDate {
  return toIsoDate(now)
}

export function addDays(s: IsoDate, n: number): IsoDate {
  return toIsoDate(new Date(parseIsoDate(s).getTime() + n * DAY_MS))
}

/** Number of days in the range, counting both ends. */
export function rangeLength({ from, to }: DateRange): number {
  return Math.round((parseIsoDate(to).getTime() - parseIsoDate(from).getTime()) / DAY_MS) + 1
}

export function eachDay(range: DateRange): IsoDate[] {
  const days: IsoDate[] = []
  for (let i = 0, n = rangeLength(range); i < n; i++) days.push(addDays(range.from, i))
  return days
}

/** The range of the same length that ends the day before `range` starts. */
export function previousPeriod(range: DateRange): DateRange {
  const length = rangeLength(range)
  return { from: addDays(range.from, -length), to: addDays(range.from, -1) }
}

/** The last `days` days ending today (UTC). Connectors re-fetch this window on every run. */
export function trailingRange(days: number, now: Date = new Date()): DateRange {
  const to = todayUtc(now)
  return { from: addDays(to, -(days - 1)), to }
}
