import { z } from 'zod'
import { rangeLength } from '../lib/dates.js'

export const MAX_RANGE_DAYS = 366

/** The date-range fields every time-based query takes. */
export const rangeFields = {
  from: z.iso.date().describe('First day, inclusive, as YYYY-MM-DD (UTC).'),
  to: z.iso.date().describe('Last day, inclusive, as YYYY-MM-DD (UTC).'),
}

/** Rejects a range that runs backwards or is longer than a year. Use with `superRefine`. */
export function checkRange(range: { from: string; to: string }, ctx: z.RefinementCtx) {
  if (range.from > range.to) {
    ctx.addIssue({ code: 'custom', message: '`from` must not be after `to`', path: ['from'] })
  } else if (rangeLength(range) > MAX_RANGE_DAYS) {
    ctx.addIssue({
      code: 'custom',
      message: `range must be at most ${MAX_RANGE_DAYS} days`,
      path: ['to'],
    })
  }
}
