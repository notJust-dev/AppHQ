import { describe, expect, it } from 'vitest'
import { salesReport } from './fixtures.js'
import { summarizeSalesReport } from './sales-report.js'

describe('summarizeSalesReport', () => {
  it('adds up first downloads per app across countries and device types', () => {
    const totals = summarizeSalesReport(
      salesReport([
        { appleId: '111', productType: '1F', units: 10, country: 'US' },
        { appleId: '111', productType: '1F', units: 5, country: 'DE' },
        { appleId: '111', productType: '1T', units: 2 },
        { appleId: '222', productType: '1', units: 7 },
      ]),
    )
    expect(totals.get('111')?.downloads).toBe(17)
    expect(totals.get('222')?.downloads).toBe(7)
  })

  it('keeps re-downloads and updates apart from first downloads', () => {
    const totals = summarizeSalesReport(
      salesReport([
        { appleId: '111', productType: '1F', units: 10 },
        { appleId: '111', productType: '3F', units: 4 },
        { appleId: '111', productType: '7F', units: 20 },
      ]),
    )
    expect(totals.get('111')).toEqual({ downloads: 10, redownloads: 4, updates: 20 })
  })

  it('ignores purchases, which carry their own identifier', () => {
    const totals = summarizeSalesReport(
      salesReport([
        { appleId: '111', productType: '1F', units: 10 },
        { appleId: '999', productType: 'IAY', units: 3 },
        { appleId: '998', productType: 'IA1', units: 1 },
      ]),
    )
    expect([...totals.keys()]).toEqual(['111'])
  })

  it('lets a refund reduce the total', () => {
    const totals = summarizeSalesReport(
      salesReport([
        { appleId: '111', productType: '1F', units: 10 },
        { appleId: '111', productType: '1F', units: -1 },
      ]),
    )
    expect(totals.get('111')?.downloads).toBe(9)
  })

  it('finds columns by name, whatever their order', () => {
    const report = ['Units\tApple Identifier\tProduct Type Identifier', '6\t111\t1F'].join('\n')
    expect(summarizeSalesReport(report).get('111')?.downloads).toBe(6)
  })

  it('says which column is missing from an unexpected file', () => {
    expect(() => summarizeSalesReport('Title\tUnits\nApp\t1')).toThrow(/Apple Identifier/)
  })
})
