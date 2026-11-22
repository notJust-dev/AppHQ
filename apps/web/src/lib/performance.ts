/** What a performance page knows about one app: its summaries, overall and by source. */
export interface AppNumbers {
  totals: Record<string, number | null>
  previous?: Record<string, number | null>
  bySource?: Record<string, Record<string, number | null>>
  previousBySource?: Record<string, Record<string, number | null>>
}

/**
 * `numerator` per `denominator`, summed over only the apps that report both, so an app without
 * RevenueCat does not add its downloads to revenue per download. With `bySource` (or one
 * `source`), apps are paired store by store instead, so one store's downloads never meet
 * another's page views. Null when no app reports both, or the denominator is zero.
 */
export function pairedRatio(
  apps: AppNumbers[],
  numerator: string,
  denominator: string,
  options: { period?: 'current' | 'previous'; bySource?: boolean; source?: string } = {},
): number | null {
  const previous = options.period === 'previous'
  let top = 0
  let bottom = 0
  let any = false
  const add = (a: number | null | undefined, b: number | null | undefined) => {
    if (a === null || a === undefined || b === null || b === undefined) return
    top += a
    bottom += b
    any = true
  }
  for (const app of apps) {
    if (options.bySource || options.source) {
      // An API from before these fields (for a moment during a deploy) sends none.
      const sources = (previous ? app.previousBySource : app.bySource) ?? {}
      const tops = sources[numerator] ?? {}
      const bottoms = sources[denominator] ?? {}
      for (const source of Object.keys(tops)) {
        if (options.source && source !== options.source) continue
        add(tops[source], bottoms[source])
      }
    } else {
      const totals = (previous ? app.previous : app.totals) ?? {}
      add(totals[numerator], totals[denominator])
    }
  }
  return any && bottom > 0 ? top / bottom : null
}
