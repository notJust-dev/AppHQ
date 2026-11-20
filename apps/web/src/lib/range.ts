export const RANGE_DAYS = { '7d': 7, '28d': 28, '90d': 90 } as const

export type RangeKey = keyof typeof RANGE_DAYS

export const RANGE_KEYS = Object.keys(RANGE_DAYS) as [RangeKey, ...RangeKey[]]

export const RANGE_LABELS: Record<RangeKey, string> = {
  '7d': '7 days',
  '28d': '28 days',
  '90d': '90 days',
}

const DAY_MS = 86_400_000
const isoDate = (d: Date) => d.toISOString().slice(0, 10)

/**
 * The dates a range covers. It ends yesterday (UTC): today is never complete, and most sources
 * report a day late.
 */
export function rangeToDates(key: RangeKey, now: Date = new Date()): { from: string; to: string } {
  const to = new Date(now.getTime() - DAY_MS)
  const from = new Date(to.getTime() - (RANGE_DAYS[key] - 1) * DAY_MS)
  return { from: isoDate(from), to: isoDate(to) }
}
