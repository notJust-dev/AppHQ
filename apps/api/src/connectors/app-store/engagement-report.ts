import type { IsoDate } from '../../lib/dates.js'

/** What one day of the Discovery and Engagement report adds up to for an app. */
export interface EngagementDay {
  /** The app's icon shown in a list (search results, charts, Today); page views not included. */
  impressions: number
  /** Its product page or store sheet opened, as App Store Connect counts product page views. */
  pageViews: number
}

/** Page types App Store Connect counts as product page views. */
const PRODUCT_PAGE_TYPES = new Set(['Product page', 'Store sheet'])

/**
 * Daily totals from one file of the "App Store Discovery and Engagement Standard" report:
 * tab-separated, a header row, one row per day and combination of source, device, territory and
 * so on. Counts add up across rows; Unique Counts do not, so they are not used. Rows for fewer
 * than five people are left out by Apple, so a day missing from the file is unknown, not zero.
 */
export function summarizeEngagementReport(text: string, appleId?: string): Map<IsoDate, EngagementDay> {
  const days = new Map<IsoDate, EngagementDay>()
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '')
  const header = lines[0]?.split('\t').map((name) => name.trim())
  if (!header) return days

  const column = (name: string) => header.indexOf(name)
  const at = {
    date: column('Date'),
    app: column('App Apple Identifier'),
    event: column('Event'),
    pageType: column('Page Type'),
    counts: column('Counts'),
  }
  if (at.date < 0 || at.event < 0 || at.counts < 0) {
    throw new Error(`The engagement report has unexpected columns: ${header.join(', ')}`)
  }

  for (const line of lines.slice(1)) {
    const cells = line.split('\t')
    const date = cells[at.date]?.trim()
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
    if (appleId && at.app >= 0 && cells[at.app]?.trim() !== appleId) continue
    const counts = Number(cells[at.counts])
    if (!Number.isFinite(counts)) continue

    const day = days.get(date) ?? { impressions: 0, pageViews: 0 }
    const event = cells[at.event]?.trim()
    if (event === 'Impression') day.impressions += counts
    if (event === 'Page view' && PRODUCT_PAGE_TYPES.has(cells[at.pageType]?.trim() ?? '')) day.pageViews += counts
    days.set(date, day)
  }
  return days
}

/** One instance of the report, read: when Apple made it, from which request, and its days. */
export interface Vintage {
  processingDate: IsoDate
  /** From the ongoing request, as opposed to the one-time history snapshot. */
  ongoing: boolean
  days: Map<IsoDate, EngagementDay>
}

/**
 * Each day as the most authoritative instance tells it. Apple restates recent days in later
 * instances, and a newer instance replaces an older one; adding them up would count a day two or
 * three times. Ongoing instances win over the history snapshot, which can overlap their first
 * days.
 */
export function mergeVintages(vintages: Vintage[]): Map<IsoDate, EngagementDay> {
  const rank = (vintage: Vintage) => `${vintage.ongoing ? 1 : 0}:${vintage.processingDate}`
  const best = new Map<IsoDate, { rank: string; day: EngagementDay }>()
  for (const vintage of vintages) {
    const vintageRank = rank(vintage)
    for (const [date, day] of vintage.days) {
      const current = best.get(date)
      if (!current || vintageRank > current.rank) best.set(date, { rank: vintageRank, day })
    }
  }
  return new Map([...best].map(([date, { day }]) => [date, day]))
}
