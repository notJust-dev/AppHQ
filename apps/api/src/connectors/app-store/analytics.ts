import type { NewMetric } from '../../db/schema.js'
import { addDays, type DateRange, type IsoDate } from '../../lib/dates.js'
import { mapLimit } from '../../lib/pool.js'
import { AppStoreError, type AppStoreClient, type ReportInstance } from './client.js'
import { mergeVintages, summarizeEngagementReport, type Vintage } from './engagement-report.js'

/** A daily instance restates up to this many days before its processing date. */
export const RESTATED_DAYS = 3

/** What the App Store connection remembers about its analytics reports between syncs. */
export interface AnalyticsState {
  /** The key may not ask Apple to start analytics reports; that needs an Admin key once. */
  needsAdmin: boolean
  /** Apps (by Apple ID) whose history snapshot has been read; it is read once. */
  snapshotRead: string[]
}

export const emptyAnalyticsState = (): AnalyticsState => ({ needsAdmin: false, snapshotRead: [] })

export function readAnalyticsState(details: unknown): AnalyticsState {
  const stored = (details as { analytics?: Partial<AnalyticsState> } | null)?.analytics
  return {
    needsAdmin: stored?.needsAdmin === true,
    snapshotRead: Array.isArray(stored?.snapshotRead) ? stored.snapshotRead.filter((id) => typeof id === 'string') : [],
  }
}

/**
 * Daily store page views and impressions for the tracked apps, from Apple's "App Store Discovery
 * and Engagement" report. Apple makes these reports only after it is asked, per app: an ongoing
 * request for every day from then on, and a one-time snapshot for the history (from January
 * 2024). Asking needs an Admin key; reading works with Sales and Reports. Days are UTC and
 * complete within three days.
 */
export async function syncStoreAnalytics(args: {
  client: AppStoreClient
  tracked: { id: string; iosAppId: string; name: string }[]
  range: DateRange
  state: AnalyticsState
  today: IsoDate
}): Promise<{ rows: NewMetric[]; state: AnalyticsState; failures: string[] }> {
  const { client, range, today } = args
  const state: AnalyticsState = { needsAdmin: false, snapshotRead: [...args.state.snapshotRead] }
  const rows: NewMetric[] = []
  const failures: string[] = []
  // Only an Admin key may ask; after the first refusal the others would be refused too.
  let mayAsk = true

  const ask = async (appleId: string, accessType: 'ONGOING' | 'ONE_TIME_SNAPSHOT') => {
    if (!mayAsk) return
    try {
      await client.createReportRequest(appleId, accessType)
    } catch (err) {
      if (err instanceof AppStoreError && err.status === 403) {
        mayAsk = false
        state.needsAdmin = true
        return
      }
      throw err
    }
  }

  const read = async (instances: ReportInstance[], ongoing: boolean, appleId: string): Promise<Vintage[]> => {
    const vintages: Vintage[] = []
    await mapLimit(instances, 4, async (instance) => {
      // An instance can come in several files; together they are its days.
      const days = new Map<IsoDate, { impressions: number; pageViews: number }>()
      for (const file of await client.downloadInstance(instance.id)) {
        for (const [date, day] of summarizeEngagementReport(file, appleId)) {
          const sum = days.get(date) ?? { impressions: 0, pageViews: 0 }
          days.set(date, { impressions: sum.impressions + day.impressions, pageViews: sum.pageViews + day.pageViews })
        }
      }
      vintages.push({ processingDate: instance.processingDate, ongoing, days })
    })
    return vintages
  }

  for (const app of args.tracked) {
    try {
      const requests = await client.listReportRequests(app.iosAppId)
      const ongoing = requests.find((request) => request.accessType === 'ONGOING' && !request.stopped)
      const snapshot = requests.find((request) => request.accessType === 'ONE_TIME_SNAPSHOT')
      if (!ongoing) await ask(app.iosAppId, 'ONGOING')
      if (!snapshot) await ask(app.iosAppId, 'ONE_TIME_SNAPSHOT')

      const ongoingReport = ongoing ? await client.findEngagementReport(ongoing.id) : null
      const ongoingInstances = ongoingReport ? await client.listDailyInstances(ongoingReport) : []
      const firstProcessed = ongoingInstances.map((instance) => instance.processingDate).sort()[0]

      // The history is read once, together with the first ongoing instances it overlaps.
      const readHistory = snapshot !== undefined && !state.snapshotRead.includes(app.iosAppId)
      const snapshotReport = readHistory && snapshot ? await client.findEngagementReport(snapshot.id) : null
      const snapshotInstances = snapshotReport ? await client.listDailyInstances(snapshotReport) : []
      const withHistory = snapshotInstances.length > 0

      // Every instance that can hold a day of the range, so each day is told by its newest one.
      const ongoingToRead = ongoingInstances.filter(
        (instance) =>
          instance.processingDate >= range.from ||
          (withHistory && firstProcessed !== undefined && instance.processingDate <= addDays(firstProcessed, RESTATED_DAYS)),
      )
      const vintages = [
        ...(await read(ongoingToRead, true, app.iosAppId)),
        ...(withHistory ? await read(snapshotInstances, false, app.iosAppId) : []),
      ]

      for (const [date, day] of mergeVintages(vintages)) {
        // A day before the range was only read in full when the history came with it.
        const complete = date >= range.from || (withHistory && (firstProcessed === undefined || date <= firstProcessed))
        if (!complete || date > today) continue
        rows.push({ appId: app.id, date, source: 'app_store', metric: 'page_views', value: day.pageViews })
        rows.push({ appId: app.id, date, source: 'app_store', metric: 'impressions', value: day.impressions })
      }
      if (withHistory) state.snapshotRead.push(app.iosAppId)
    } catch (err) {
      failures.push(`${app.name} analytics: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return { rows, state, failures }
}
