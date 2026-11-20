/** Test data shaped like Apple's Summary Sales Report, with made-up apps and numbers. */

const COLUMNS = [
  'Provider',
  'Provider Country',
  'SKU',
  'Developer',
  'Title',
  'Version',
  'Product Type Identifier',
  'Units',
  'Developer Proceeds',
  'Begin Date',
  'End Date',
  'Customer Currency',
  'Country Code',
  'Currency of Proceeds',
  'Apple Identifier',
  'Customer Price',
  'Promo Code',
  'Parent Identifier',
  'Subscription',
  'Period',
  'Category',
  'CMB',
  'Device',
  'Supported Platforms',
  'Proceeds Reason',
  'Preserved Pricing',
  'Client',
  'Order Type',
]

export interface SalesRow {
  appleId: string
  productType: string
  units: number
  country?: string
}

export function salesReport(rows: SalesRow[]): string {
  const line = (row: SalesRow) =>
    COLUMNS.map((column) => {
      switch (column) {
        case 'Apple Identifier':
          return row.appleId
        case 'Product Type Identifier':
          return row.productType
        case 'Units':
          return String(row.units)
        case 'Country Code':
          return row.country ?? 'US'
        case 'Provider':
          return 'APPLE'
        default:
          return ''
      }
    }).join('\t')
  return [COLUMNS.join('\t'), ...rows.map(line), ''].join('\n')
}
