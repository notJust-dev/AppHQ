import { describe, expect, it } from 'vitest'
import { mergeVintages, summarizeEngagementReport } from './engagement-report.js'

const HEADER =
  'Date\tApp Name\tApp Apple Identifier\tEvent\tPage Type\tSource Type\tEngagement Type\tDevice\tPlatform Version\tTerritory\tCounts\tUnique Counts'

/** One row of the Standard report, as Apple writes it. */
const row = (date: string, event: string, pageType: string, counts: number, appleId = '111') =>
  [date, 'Example', appleId, event, pageType, 'App Store search', '', 'iPhone', 'iOS 26.6', 'US', counts, counts].join('\t')

describe('summarizeEngagementReport', () => {
  it('adds up impressions and product page views per day', () => {
    const text = [
      HEADER,
      row('2026-11-19', 'Impression', 'No page', 40),
      row('2026-11-19', 'Impression', 'No page', 2),
      row('2026-11-19', 'Page view', 'Product page', 7),
      row('2026-11-19', 'Page view', 'Store sheet', 3),
      // Not product page views as App Store Connect counts them.
      row('2026-11-19', 'Page view', 'Developer page', 5),
      row('2026-11-19', 'Tap', 'No page', 9),
      row('2026-11-20', 'Impression', 'No page', 11),
    ].join('\n')

    expect(summarizeEngagementReport(text)).toEqual(
      new Map([
        ['2026-11-19', { impressions: 42, pageViews: 10 }],
        ['2026-11-20', { impressions: 11, pageViews: 0 }],
      ]),
    )
  })

  it("keeps only the asked app's rows, and copes with Windows line ends", () => {
    const text = [HEADER, row('2026-11-19', 'Page view', 'Product page', 4), row('2026-11-19', 'Page view', 'Product page', 9, '222')].join('\r\n')

    expect(summarizeEngagementReport(text, '111').get('2026-11-19')).toEqual({ impressions: 0, pageViews: 4 })
  })

  it('refuses a file without the columns it needs', () => {
    expect(() => summarizeEngagementReport('Day\tViews\n2026-11-19\t3')).toThrow(/unexpected columns/)
  })
})

describe('mergeVintages', () => {
  const day = (pageViews: number) => ({ impressions: 0, pageViews })

  it('takes each day from the newest instance instead of adding restatements up', () => {
    const merged = mergeVintages([
      { processingDate: '2026-11-20', ongoing: true, days: new Map([['2026-11-18', day(5)], ['2026-11-19', day(6)]]) },
      { processingDate: '2026-11-21', ongoing: true, days: new Map([['2026-11-19', day(8)], ['2026-11-20', day(2)]]) },
    ])

    expect(merged).toEqual(new Map([['2026-11-18', day(5)], ['2026-11-19', day(8)], ['2026-11-20', day(2)]]))
  })

  it('prefers the ongoing report over the history snapshot where they overlap', () => {
    const merged = mergeVintages([
      { processingDate: '2026-11-19', ongoing: true, days: new Map([['2026-11-18', day(5)]]) },
      { processingDate: '2026-11-25', ongoing: false, days: new Map([['2026-11-17', day(3)], ['2026-11-18', day(4)]]) },
    ])

    expect(merged).toEqual(new Map([['2026-11-17', day(3)], ['2026-11-18', day(5)]]))
  })
})
