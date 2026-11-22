import { Link } from '@tanstack/react-router'
import { createColumnHelper, useTable } from '@tanstack/react-table'
import { useMemo } from 'react'
import { AppIcon } from '@/components/AppIcon'
import { Private } from '@/components/Private'
import { DataTable, sortableFeatures, type SortableFeatures } from '@/components/DataTable'
import { NoData } from '@/components/NoData'
import type { RangeKey } from '@/lib/range'

export interface ComparisonRow {
  app: { id: string; name: string; kind: string; iconUrl?: string | null }
  /** Each column's number for this app, or null when nothing reported it. */
  values: Record<string, number | null>
}

export interface ComparisonColumn {
  key: string
  label: string
  format: (value: number) => string
}

const helper = createColumnHelper<SortableFeatures, ComparisonRow>()

/**
 * Every app side by side on a performance page's numbers. Any column sorts it; apps with no
 * data for a column stay at the bottom whichever way it is sorted.
 */
export function AppComparison(props: {
  rows: ComparisonRow[]
  columns: ComparisonColumn[]
  /** The column the table starts sorted by, biggest first. */
  sortBy: string
  range: RangeKey
}) {
  const { range } = props
  const columns = useMemo(
    () =>
      helper.columns([
        helper.accessor((row) => (row.app.kind === 'portfolio' ? 'Shared accounts' : row.app.name), {
          id: 'app',
          header: 'App',
          sortFn: 'alphanumeric',
          cell: (info) => (
            <span className="flex items-center gap-2.5">
              <AppIcon app={{ ...info.row.original.app, name: info.getValue() }} className="size-5 text-[10px]" />
              <Link
                to="/apps/$appId"
                params={{ appId: info.row.original.app.id }}
                search={{ range }}
                className="hover:underline hover:underline-offset-4"
              >
                {info.row.original.app.kind === 'portfolio' ? info.getValue() : <Private>{info.getValue()}</Private>}
              </Link>
            </span>
          ),
        }),
        ...props.columns.map((column) =>
          helper.accessor((row) => row.values[column.key] ?? undefined, {
            id: column.key,
            header: column.label,
            sortUndefined: 'last',
            sortDescFirst: true,
            meta: { align: 'right' },
            cell: (info) => {
              const value = info.getValue()
              return value === undefined ? (
                <span className="text-faint">
                  <NoData />
                </span>
              ) : (
                <span className="figures">{column.format(value)}</span>
              )
            },
          }),
        ),
      ]),
    [props.columns, range],
  )

  const table = useTable({
    features: sortableFeatures,
    columns,
    data: props.rows,
    initialState: { sorting: [{ id: props.sortBy, desc: true }] },
    enableSortingRemoval: false,
  })

  return <DataTable table={table} minWidth={120 + props.columns.length * 130} />
}
