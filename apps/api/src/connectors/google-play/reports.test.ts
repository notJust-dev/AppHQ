import { describe, expect, it } from 'vitest'
import {
  dailyInstalls,
  dailyVisitors,
  decodeReport,
  monthsIn,
  parseCsv,
  parseInstallsName,
  parseStoreName,
} from './reports.js'

const utf16le = (text: string) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')])

describe('Google Play report files', () => {
  it('reads package names that contain underscores, anchored on the month', () => {
    expect(parseInstallsName('stats/installs/installs_com.tiny_kicks.app_202611_overview.csv')).toEqual({
      name: 'stats/installs/installs_com.tiny_kicks.app_202611_overview.csv',
      packageName: 'com.tiny_kicks.app',
      month: '202611',
      dimension: 'overview',
    })
    expect(parseStoreName('stats/store_performance/store_performance_com.example_202610_traffic_source.csv'))
      .toMatchObject({ packageName: 'com.example', dimension: 'traffic_source' })
    expect(parseInstallsName('stats/installs/installs_com.example_202611_unknown.csv')).toBeNull()
  })

  it('decodes UTF-16 in either byte order, and UTF-8', () => {
    expect(decodeReport(utf16le('Date,Package Name'))).toBe('Date,Package Name')
    const be = Buffer.from('Date', 'utf16le')
    be.swap16()
    expect(decodeReport(Buffer.concat([Buffer.from([0xfe, 0xff]), be]))).toBe('Date')
    expect(decodeReport(Buffer.from('Date', 'utf16le'))).toBe('Date')
    expect(decodeReport(Buffer.from('﻿Date', 'utf8'))).toBe('Date')
  })

  it('parses quoted cells with commas, quotes and newlines', () => {
    expect(parseCsv('a,"b,c","say ""hi""","two\nlines"\r\n1,2,3,4\n')).toEqual([
      ['a', 'b,c', 'say "hi"', 'two\nlines'],
      ['1', '2', '3', '4'],
    ])
  })

  it('takes Daily User Installs per day, and falls back to older columns', () => {
    const current = [
      'Date,Package Name,Daily Device Installs,Daily Device Uninstalls,Daily User Installs,Daily User Uninstalls',
      '2026-11-01,com.tinykicks,40,3,"1,234",2',
      '2026-11-02,com.tinykicks,12,1,9,0',
    ].join('\n')
    expect(Object.fromEntries(dailyInstalls(decodeReport(utf16le(current))))).toEqual({
      '2026-11-01': 1234,
      '2026-11-02': 9,
    })

    const devicesOnly = 'Date,Package Name,Daily Device Installs\n2026-11-01,com.tinykicks,40\n'
    expect(Object.fromEntries(dailyInstalls(devicesOnly))).toEqual({ '2026-11-01': 40 })
  })

  it('sums store listing visitors over countries', () => {
    const csv = [
      'Date,Package name,Country/region,Store listing acquisitions,Store listing visitors,Store listing conversion rate',
      '2026-11-01,com.tinykicks,US,10,200,5%',
      '2026-11-01,com.tinykicks,DE,4,80,5%',
      '2026-11-02,com.tinykicks,US,0,0,0%',
    ].join('\n')
    expect(Object.fromEntries(dailyVisitors(csv))).toEqual({ '2026-11-01': 280, '2026-11-02': 0 })
  })

  it('lists the months a range touches, across a year end', () => {
    expect(monthsIn('2025-11-20', '2026-02-03')).toEqual(['202511', '202512', '202601', '202602'])
  })
})
