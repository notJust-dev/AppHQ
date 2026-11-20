const whole = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
const oneDecimal = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})
const compact = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
})
const dollars = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})
const cents = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const day = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

export const formatCount = (n: number) => whole.format(n)
/** 1,284,300 → 1.3M. For headline numbers, where the exact figure is in the table below. */
export const formatCompact = (n: number) => (n < 10_000 ? whole.format(n) : compact.format(n))
export const formatMoney = (n: number) => (Math.abs(n) < 100 ? cents.format(n) : dollars.format(n))
export const formatRatio = (n: number) => oneDecimal.format(n)
export const formatDay = (iso: string) => day.format(new Date(`${iso}T00:00:00Z`))

export interface Change {
  direction: 'up' | 'down' | 'flat'
  /** e.g. "12%"; "new" when there was nothing to compare against. */
  label: string
}

/** Change from the previous period, or null when both periods are empty. */
export function change(current: number, previous: number): Change | null {
  if (previous === 0) return current === 0 ? null : { direction: 'up', label: 'new' }
  const percent = Math.round(((current - previous) / previous) * 100)
  if (percent === 0) return { direction: 'flat', label: '0%' }
  return { direction: percent > 0 ? 'up' : 'down', label: `${Math.abs(percent)}%` }
}

/** a per b, or null when b is zero. */
export const per = (a: number, b: number) => (b === 0 ? null : a / b)
