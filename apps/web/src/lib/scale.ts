/**
 * A y-axis that ends on a round number just above `max`, with ticks at clean steps: 0, 100K,
 * 200K, 300K rather than 0, 70K, 140K, 210K. Counts get whole-number steps only.
 */
export function niceScale(
  max: number,
  options: { maxSteps?: number; integer?: boolean } = {},
): { max: number; ticks: number[] } {
  const { maxSteps = 3, integer = false } = options
  if (!(max > 0)) return { max: 1, ticks: [0] }

  const power = 10 ** Math.floor(Math.log10(max / maxSteps))
  const candidates = [1, 2, 2.5, 5, 10, 20, 25, 50, 100]
    .map((m) => m * power)
    .filter((step) => !integer || (step >= 1 && Number.isInteger(step)))
  // The smallest round step that covers `max` in at most `maxSteps`: the tightest top.
  const step =
    candidates.find((candidate) => Math.ceil(max / candidate) <= maxSteps) ??
    Math.ceil(max / maxSteps)
  const top = Math.ceil(max / step) * step

  const ticks: number[] = []
  for (let tick = 0; tick <= top + step / 1000; tick += step) {
    ticks.push(Number(tick.toPrecision(12)))
  }
  return { max: top, ticks }
}

/** Up to `count` evenly spaced indexes into `length` items, always including the first and last. */
export function tickIndexes(length: number, count = 6): number[] {
  if (length <= 1) return length === 1 ? [0] : []
  const step = Math.max(1, Math.ceil((length - 1) / (count - 1)))
  const last = length - 1
  const indexes: number[] = []
  for (let index = 0; index < last; index += step) indexes.push(index)
  // Drop the tick before the last one when it would crowd it.
  if (indexes.length > 1 && last - (indexes.at(-1) ?? 0) < step * 0.75) indexes.pop()
  indexes.push(last)
  return indexes
}
