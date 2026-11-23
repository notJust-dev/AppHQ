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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableRowHead,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'

/** What the shared table needs to know about a column beyond what TanStack Table tracks. */
export interface DataColumnMeta {
  /** Numbers line up on the right. */
  align?: 'left' | 'right'
  /** Classes for the column's heading, such as a width. */
  headClassName?: string
  /** Classes for each of the column's cells. */
  cellClassName?: string
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
 * A shadcn/ui table whose column headers sort it. TanStack Table owns the order and the sort
 * state; this owns the markup: header buttons, `aria-sort` on the sorted column, and one column
 * as each row's header (the first, unless `rowHeader` names another).
 */
export function DataTable<TData extends RowData>(props: {
  table: ReactTable<SortableFeatures, TData>
  /** Below this width the table scrolls sideways instead of squeezing its columns. */
  minWidth?: number
  /** Names the table for screen readers when the heading above it does not. */
  label?: string
  /** The id of the column that names each row, when it is not the first. */
  rowHeader?: string
  className?: string
  rowClassName?: string
}) {
  const { table } = props

  return (
    <Table style={{ minWidth: props.minWidth }} aria-label={props.label} className={props.className}>
      <TableHeader>
        {table.getHeaderGroups().map((group) => (
          <TableRow key={group.id}>
            {group.headers.map((header) => {
              const meta = header.column.columnDef.meta
              const right = meta?.align === 'right'
              const sorted = header.column.getIsSorted()
              const canSort = header.column.getCanSort()
              const Icon = sorted === 'asc' ? ArrowUp : sorted === 'desc' ? ArrowDown : ChevronsUpDown
              return (
                <TableHead
                  key={header.id}
                  scope="col"
                  aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined}
                  className={cn(right && 'text-right', meta?.headClassName)}
                >
                  {header.isPlaceholder ? null : canSort ? (
                    <button
                      type="button"
                      onClick={header.column.getToggleSortingHandler()}
                      className={cn(
                        'group inline-flex cursor-pointer items-center gap-1 rounded-sm font-medium hover:text-foreground',
                        right && 'flex-row-reverse',
                        sorted && 'text-foreground',
                      )}
                    >
                      <table.FlexRender header={header} />
                      <Icon
                        className={cn(
                          'size-3.5 shrink-0',
                          !sorted && 'text-faint opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100',
                        )}
                        aria-hidden="true"
                      />
                    </button>
                  ) : (
                    <table.FlexRender header={header} />
                  )}
                </TableHead>
              )
            })}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {table.getRowModel().rows.map((row) => (
          <TableRow key={row.id} className={props.rowClassName}>
            {row.getAllCells().map((cell, index) => {
              const meta = cell.column.columnDef.meta
              const cellClass = cn(meta?.align === 'right' && 'text-right', meta?.cellClassName)
              const namesRow = props.rowHeader ? cell.column.id === props.rowHeader : index === 0
              // That column names the row, so screen readers announce it with each cell.
              return namesRow ? (
                <TableRowHead key={cell.id} className={cellClass}>
                  <table.FlexRender cell={cell} />
                </TableRowHead>
              ) : (
                <TableCell key={cell.id} className={cellClass}>
                  <table.FlexRender cell={cell} />
                </TableCell>
              )
            })}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
