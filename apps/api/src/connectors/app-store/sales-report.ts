/**
 * Reading Apple's Summary Sales Report: one row per product, country and price, with a product
 * type that says whether the row is a first download, a re-download, an update or a purchase.
 */

/** Product types for a first download of an app. Paid or free; everything else is not a new user. */
const FIRST_DOWNLOAD = new Set(['1', '1F', '1T', 'F1', '1E', '1EP', '1EU'])
const REDOWNLOAD = new Set(['3', '3F', '3T', 'F3'])
const UPDATE = new Set(['7', '7F', '7T', 'F7'])

export interface AppDownloads {
  downloads: number
  redownloads: number
  updates: number
}

/**
 * Totals per app, keyed by Apple ID. Columns are found by name, so a report version that adds or
 * reorders columns still parses. Refunds arrive as negative units and reduce the total.
 */
export function summarizeSalesReport(tsv: string): Map<string, AppDownloads> {
  const [headerLine, ...lines] = tsv.split(/\r?\n/)
  const headers = (headerLine ?? '').split('\t').map((header) => header.trim())
  const column = (name: string) => {
    const index = headers.indexOf(name)
    if (index === -1) throw new Error(`Sales report has no "${name}" column`)
    return index
  }
  const appleId = column('Apple Identifier')
  const productType = column('Product Type Identifier')
  const units = column('Units')

  const totals = new Map<string, AppDownloads>()
  for (const line of lines) {
    if (line.trim() === '') continue
    const cells = line.split('\t')
    const type = cells[productType]?.trim() ?? ''
    const count = Number(cells[units])
    const id = cells[appleId]?.trim()
    if (!id || !Number.isFinite(count)) continue

    const key = FIRST_DOWNLOAD.has(type)
      ? 'downloads'
      : REDOWNLOAD.has(type)
        ? 'redownloads'
        : UPDATE.has(type)
          ? 'updates'
          : null
    if (!key) continue

    const total = totals.get(id) ?? { downloads: 0, redownloads: 0, updates: 0 }
    total[key] += count
    totals.set(id, total)
  }
  return totals
}
