import type { IsoDate } from '../../lib/dates.js'

/**
 * Google Play's monthly report files, as they sit in the developer account's Cloud Storage
 * bucket. Google documents them only loosely (UTF-16, columns that have been renamed over the
 * years), so everything here is read defensively: encoding by its byte order mark, columns by
 * header name with fallbacks, and file names anchored on the month and a known dimension.
 */

export const INSTALLS_PREFIX = 'stats/installs/installs_'
export const STORE_PREFIX = 'stats/store_performance/store_performance_'

const INSTALL_DIMENSIONS = ['overview', 'app_version', 'carrier', 'country', 'device', 'language', 'os_version']
const STORE_DIMENSIONS = ['country', 'traffic_source']

export interface ReportFile {
  name: string
  packageName: string
  /** YYYYMM */
  month: string
  dimension: string
}

/** Package names may contain `_`, so the pattern anchors on the month and the dimension. */
function parseName(name: string, prefix: string, dimensions: string[]): ReportFile | null {
  if (!name.startsWith(prefix)) return null
  const match = new RegExp(`^(.+)_(\\d{6})_(${dimensions.join('|')})\\.csv$`).exec(name.slice(prefix.length))
  if (!match) return null
  const [, packageName = '', month = '', dimension = ''] = match
  return { name, packageName, month, dimension }
}

export const parseInstallsName = (name: string) => parseName(name, INSTALLS_PREFIX, INSTALL_DIMENSIONS)
export const parseStoreName = (name: string) => parseName(name, STORE_PREFIX, STORE_DIMENSIONS)

/** Reads a report file: UTF-16 (either byte order) or UTF-8, with or without a byte order mark. */
export function decodeReport(bytes: Buffer): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return bytes.subarray(2).toString('utf16le')
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    const swapped = Buffer.from(bytes.subarray(2))
    swapped.swap16()
    return swapped.toString('utf16le')
  }
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return bytes.subarray(3).toString('utf8')
  // UTF-16LE without a mark: ASCII text has a zero in every second byte.
  if (bytes.length >= 4 && bytes[1] === 0 && bytes[3] === 0) return bytes.toString('utf16le')
  return bytes.toString('utf8')
}

/** RFC 4180 CSV: quoted cells may hold commas, newlines and doubled quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (char === '"') {
        quoted = false
      } else {
        cell += char
      }
    } else if (char === '"') {
      quoted = true
    } else if (char === ',') {
      row.push(cell)
      cell = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      if (row.some((value) => value !== '')) rows.push(row)
      row = []
      cell = ''
    } else {
      cell += char
    }
  }
  row.push(cell)
  if (row.some((value) => value !== '')) rows.push(row)
  return rows
}

/** The rows as objects keyed by lower-cased header, for lookups that survive renamed columns. */
export function records(text: string): Record<string, string>[] {
  const [header, ...rows] = parseCsv(text)
  if (!header) return []
  const keys = header.map((name) => name.trim().toLowerCase())
  return rows.map((row) => Object.fromEntries(keys.map((key, index) => [key, row[index] ?? ''])))
}

export const pick = (record: Record<string, string>, names: string[]): string | undefined => {
  for (const name of names) {
    const value = record[name]
    if (value !== undefined && value.trim() !== '') return value
  }
  return undefined
}

/** A count as written in the reports: "1,234", "1234", or empty. */
const count = (value: string | undefined) => {
  if (value === undefined) return null
  const number = Number(value.replace(/[,\s]/g, ''))
  return Number.isFinite(number) ? number : null
}

/** Dates come as YYYY-MM-DD; other forms Date can read are accepted too. */
function day(value: string | undefined): IsoDate | null {
  if (!value) return null
  const trimmed = value.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed
  const parsed = new Date(`${trimmed} UTC`)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10)
}

/** Sums one column per day. A day that appears in the file is reported, zero included. */
function dailySum(text: string, columns: string[]): Map<IsoDate, number> {
  const totals = new Map<IsoDate, number>()
  for (const record of records(text)) {
    const date = day(record.date)
    const value = count(pick(record, columns))
    if (date === null || value === null) continue
    totals.set(date, (totals.get(date) ?? 0) + value)
  }
  return totals
}

/**
 * New users per day ("Daily User Installs", which Google maps to its "New users" metric).
 * Older or newer files may only have device installs or install events, which count a person
 * once per device or per reinstall; those are the fallback, in that order.
 */
export const dailyInstalls = (text: string) =>
  dailySum(text, ['daily user installs', 'new users', 'daily device installs', 'install events'])

/** Store listing visitors per day, from the `country` breakdown (each visitor in one country). */
export const dailyVisitors = (text: string) => dailySum(text, ['store listing visitors'])

/** Store listing acquisitions per day: visitors who installed. */
export const dailyAcquisitions = (text: string) => dailySum(text, ['store listing acquisitions'])

/** The months, as YYYYMM, that a date range touches. */
export function monthsIn(from: IsoDate, to: IsoDate): string[] {
  const months: string[] = []
  let year = Number(from.slice(0, 4))
  let month = Number(from.slice(5, 7))
  const endYear = Number(to.slice(0, 4))
  const endMonth = Number(to.slice(5, 7))
  while (year < endYear || (year === endYear && month <= endMonth)) {
    months.push(`${year}${String(month).padStart(2, '0')}`)
    month++
    if (month > 12) {
      month = 1
      year++
    }
  }
  return months
}
