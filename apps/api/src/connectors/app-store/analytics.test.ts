import { describe, expect, it } from 'vitest'
import { emptyAnalyticsState, syncStoreAnalytics, type AnalyticsState } from './analytics.js'
import { AppStoreError, type AppStoreClient, type ReportInstance, type ReportRequest } from './client.js'

const HEADER = 'Date\tApp Apple Identifier\tEvent\tPage Type\tCounts'
const file = (days: [string, number][]) =>
  [HEADER, ...days.map(([date, views]) => `${date}\t111\tPage view\tProduct page\t${views}`)].join('\n')

/** Stands in for Apple: report requests per app, instances per report, one file per instance. */
function fakeApple(setup: {
  requests: ReportRequest[]
  instances?: Record<string, (ReportInstance & { file: string })[]>
  admin?: boolean
}) {
  const asked: string[] = []
  const downloaded: string[] = []
  const all = Object.values(setup.instances ?? {}).flat()
  const client = {
    listReportRequests: async () => setup.requests,
    createReportRequest: async (appleId: string, accessType: string) => {
      if (setup.admin === false) throw new AppStoreError(403, 'FORBIDDEN_ERROR', 'not allowed')
      asked.push(`${appleId}:${accessType}`)
    },
    findEngagementReport: async (requestId: string) => (setup.instances?.[requestId] ? `report-${requestId}` : null),
    listDailyInstances: async (reportId: string) =>
      (setup.instances?.[reportId.replace('report-', '')] ?? []).map(({ id, processingDate }) => ({ id, processingDate })),
    downloadInstance: async (instanceId: string) => {
      downloaded.push(instanceId)
      return [all.find((instance) => instance.id === instanceId)?.file ?? '']
    },
  } as unknown as AppStoreClient
  return { client, asked, downloaded }
}

const tracked = [{ id: 'app-one', iosAppId: '111', name: 'App One' }]
const run = (client: AppStoreClient, from: string, state: AnalyticsState = emptyAnalyticsState()) =>
  syncStoreAnalytics({ client, tracked, range: { from, to: '2026-11-21' }, state, today: '2026-11-22' })
const pageViews = (rows: { date: string; metric: string; value: number }[]) =>
  rows.filter((row) => row.metric === 'page_views').map((row) => [row.date, row.value])

describe('syncStoreAnalytics', () => {
  it('asks Apple for the reports an app lacks, and notes when the key may not', async () => {
    const admin = fakeApple({ requests: [] })
    const asked = await run(admin.client, '2026-11-15')
    expect(admin.asked).toEqual(['111:ONGOING', '111:ONE_TIME_SNAPSHOT'])
    expect(asked).toMatchObject({ rows: [], failures: [], state: { needsAdmin: false } })

    const sales = fakeApple({ requests: [], admin: false })
    expect(await run(sales.client, '2026-11-15')).toMatchObject({ rows: [], failures: [], state: { needsAdmin: true } })
  })

  it('writes each day of the range from its newest instance, and nothing before the range', async () => {
    const apple = fakeApple({
      requests: [{ id: 'ongoing', accessType: 'ONGOING', stopped: false }, { id: 'snap', accessType: 'ONE_TIME_SNAPSHOT', stopped: false }],
      instances: {
        ongoing: [
          { id: 'i17', processingDate: '2026-11-17', file: file([['2026-11-14', 1], ['2026-11-15', 1], ['2026-11-16', 1]]) },
          { id: 'i20', processingDate: '2026-11-20', file: file([['2026-11-17', 4], ['2026-11-18', 5], ['2026-11-19', 6]]) },
          { id: 'i21', processingDate: '2026-11-21', file: file([['2026-11-18', 5], ['2026-11-19', 9], ['2026-11-20', 2]]) },
        ],
      },
    })
    // The history was read before, so only the instances that can hold days of the range are.
    const result = await run(apple.client, '2026-11-18', { needsAdmin: false, snapshotRead: ['111'] })

    expect(apple.downloaded.sort()).toEqual(['i20', 'i21'])
    expect(pageViews(result.rows)).toEqual([
      ['2026-11-18', 5],
      ['2026-11-19', 9],
      ['2026-11-20', 2],
    ])
  })

  it('reads the history once, with the ongoing days it overlaps', async () => {
    const apple = fakeApple({
      requests: [{ id: 'ongoing', accessType: 'ONGOING', stopped: false }, { id: 'snap', accessType: 'ONE_TIME_SNAPSHOT', stopped: false }],
      instances: {
        ongoing: [{ id: 'i20', processingDate: '2026-11-20', file: file([['2026-11-17', 4], ['2026-11-18', 5], ['2026-11-19', 6]]) }],
        snap: [{ id: 's1', processingDate: '2026-11-21', file: file([['2024-01-01', 2], ['2026-11-17', 3], ['2026-11-18', 3]]) }],
      },
    })
    const result = await run(apple.client, '2026-11-20')

    expect(pageViews(result.rows)).toEqual([
      ['2026-11-17', 4],
      ['2026-11-18', 5],
      ['2026-11-19', 6],
      ['2024-01-01', 2],
    ])
    expect(result.state.snapshotRead).toEqual(['111'])
  })

  it('waits for a history snapshot Apple has not made yet', async () => {
    const apple = fakeApple({
      requests: [{ id: 'ongoing', accessType: 'ONGOING', stopped: false }, { id: 'snap', accessType: 'ONE_TIME_SNAPSHOT', stopped: false }],
      instances: { ongoing: [], snap: [] },
    })
    const result = await run(apple.client, '2026-11-20')

    expect(result).toMatchObject({ rows: [], failures: [], state: { snapshotRead: [] } })
  })
})
