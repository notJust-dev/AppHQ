import { retainSearchParams, stripSearchParams } from '@tanstack/react-router'
import { z } from 'zod'

export const RANGE_DAYS = { '7d': 7, '28d': 28, '90d': 90 } as const

export type RangeKey = keyof typeof RANGE_DAYS

export const RANGE_KEYS = Object.keys(RANGE_DAYS) as [RangeKey, ...RangeKey[]]

/** The range a page shows when the address names none. */
export const DEFAULT_RANGE: RangeKey = '28d'

/**
 * The search params every dashboard page carries: `?range=`, and `?app=` for the one app the
 * numbers are limited to, if any. Unknown values fall back to 28 days and to every app.
 */
export const dashboardSearchSchema = z.object({
  range: z.enum(RANGE_KEYS).default(DEFAULT_RANGE).catch(DEFAULT_RANGE),
  app: z.uuid().optional().catch(undefined),
})

type DashboardSearch = z.infer<typeof dashboardSearchSchema>

/**
 * The app and range stay as the person moves from page to page, until they choose another: a
 * link that names neither keeps the ones in the address. The default range stays out of the
 * address, so the bare `/` stays bare for the landing page.
 */
export const dashboardSearchMiddlewares = [
  stripSearchParams<DashboardSearch>({ range: DEFAULT_RANGE }),
  retainSearchParams<DashboardSearch>(['range', 'app']),
]

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
