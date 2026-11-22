import {
  createSortedRowModel,
  metaHelper,
  rowSortingFeature,
  sortFn_alphanumeric,
  tableFeatures,
  type ReactTable,
  type RowData,
} from '@tanstack/react-table'
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import { TABLE, TD, TH, THEAD_ROW, TR } from './table'

/** What the shared table needs to know about a column beyond what TanStack Table tracks. */
export interface DataColumnMeta {
  /** Numbers line up on the right. */
  align?: 'left' | 'right'
}

/**
 * The features every sortable table uses: client sorting, text comparison for names, and the
 * column metadata above. Kept at module scope so the table's inputs stay stable.
 */
export const sortableFeatures = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric },
  columnMeta: metaHelper<DataColumnMeta>(),
})

export type SortableFeatures = typeof sortableFeatures

/**
 * A table in the dashboard's style whose column headers sort it. TanStack Table owns the order
 * and the sort state; this owns the markup: header buttons, `aria-sort` on the sorted column,
 * and the first column as each row's header.
 */
export function DataTable<TData extends RowData>(props: {
  table: ReactTable<SortableFeatures, TData>
  /** Below this width the table scrolls sideways instead of squeezing its columns. */
  minWidth?: number
  /** Names the table for screen readers when the heading above it does not. */
  label?: string
}) {
  const { table } = props

  return (
    <div className="overflow-x-auto">
      <table className={TABLE} style={{ minWidth: props.minWidth }} aria-label={props.label}>
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id} className={THEAD_ROW}>
              {group.headers.map((header) => {
                const right = header.column.columnDef.meta?.align === 'right'
                const sorted = header.column.getIsSorted()
                const canSort = header.column.getCanSort()
                const Icon = sorted === 'asc' ? ArrowUp : sorted === 'desc' ? ArrowDown : ChevronsUpDown
                return (
                  <th
                    key={header.id}
                    scope="col"
                    aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined}
                    className={`${TH} ${right ? 'text-right' : ''}`}
                  >
                    {header.isPlaceholder ? null : canSort ? (
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className={`group inline-flex cursor-pointer items-center gap-1 rounded-sm font-medium hover:text-ink ${
                          right ? 'flex-row-reverse' : ''
                        } ${sorted ? 'text-ink' : ''}`}
                      >
                        <table.FlexRender header={header} />
                        <Icon
                          className={`size-3.5 shrink-0 ${sorted ? '' : 'text-ink-faint opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100'}`}
                          aria-hidden="true"
                        />
                      </button>
                    ) : (
                      <table.FlexRender header={header} />
                    )}
                  </th>
                )
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} className={`${TR} align-middle`}>
              {row.getAllCells().map((cell, index) => {
                const right = cell.column.columnDef.meta?.align === 'right'
                const className = `${TD} ${right ? 'text-right' : 'text-left'}`
                // The first column names the row, so screen readers announce it with each cell.
                return index === 0 ? (
                  <th key={cell.id} scope="row" className={`${className} font-medium`}>
                    <table.FlexRender cell={cell} />
                  </th>
                ) : (
                  <td key={cell.id} className={className}>
                    <table.FlexRender cell={cell} />
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
