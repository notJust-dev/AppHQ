import { Link } from '@tanstack/react-router'
import { createColumnHelper, useTable } from '@tanstack/react-table'
import { useMemo, type ReactNode } from 'react'
import { change, formatCount, formatMoney, formatRatio, per } from '../lib/format'
import { reportingOf, type Overview } from '../lib/queries'
import type { RangeKey } from '../lib/range'
import { Delta } from './Delta'
import { DataTable, sortableFeatures, type SortableFeatures } from './ui/DataTable'
import { NoData } from './ui/NoData'

type AppRow = Overview['apps'][number]
/** The funnel stages the overview totals: social views, downloads, revenue. */
type HeadlineKey = keyof Overview['totals']

const helper = createColumnHelper<SortableFeatures, AppRow>()

/**
 * Each app's funnel over the range. Any column sorts it; apps with no data for a column stay at
 * the bottom whichever way it is sorted, since no data is not the smallest number.
 */
export function AppsTable({ apps, range }: { apps: Overview['apps']; range: RangeKey }) {
  const columns = useMemo(
    () =>
      helper.columns([
        helper.accessor((row) => row.app.name, {
          id: 'app',
          header: 'App',
          sortFn: 'alphanumeric',
          cell: (info) => <AppName app={info.row.original.app} range={range} />,
        }),
        stageColumn('socialViews', 'Social views', 'bg-views', formatCount),
        stageColumn('downloads', 'Downloads', 'bg-downloads', formatCount),
        stageColumn('revenue', 'Revenue', 'bg-revenue', formatMoney),
        // A conversion needs both of its stages to have numbers.
        ratioColumn(
          'downloadsPerThousandViews',
          'Downloads per 1,000 views',
          ({ totals, reporting: sent }) => {
            const reporting = reportingOf(sent)
            return reporting.socialViews && reporting.downloads ? per(totals.downloads * 1000, totals.socialViews) : null
          },
          formatRatio,
        ),
        ratioColumn(
          'revenuePerDownload',
          'Revenue per download',
          ({ totals, reporting: sent }) => {
            const reporting = reportingOf(sent)
            return reporting.revenue && reporting.downloads ? per(totals.revenue, totals.downloads) : null
          },
          formatMoney,
        ),
      ]),
    [range],
  )

  const table = useTable({
    features: sortableFeatures,
    columns,
    data: apps,
    initialState: { sorting: [{ id: 'revenue', desc: true }] },
    // Some column always orders the table.
    enableSortingRemoval: false,
  })

  return <DataTable table={table} minWidth={720} />
}

/** One funnel stage: its total, and the change against the previous period under it. */
function stageColumn(key: HeadlineKey, label: string, swatch: string, format: (value: number) => string) {
  return helper.accessor((row) => (reportingOf(row.reporting)[key] ? row.totals[key] : undefined), {
    id: key,
    header: () => <StageLabel swatch={swatch}>{label}</StageLabel>,
    sortUndefined: 'last',
    // Bigger first: the question is usually which app leads.
    sortDescFirst: true,
    meta: { align: 'right' },
    cell: (info) => {
      const value = info.getValue()
      const { totals, previous, comparable } = info.row.original
      if (value === undefined) return <Missing />
      return (
        <>
          <span className="figures block font-medium">{format(value)}</span>
          <span className="block text-xs">
            {comparable ? (
              <Delta change={change(totals[key], previous[key])} />
            ) : (
              <span className="text-ink-soft">not enough history</span>
            )}
          </span>
        </>
      )
    },
  })
}

function ratioColumn(
  id: string,
  label: string,
  ratio: (row: AppRow) => number | null,
  format: (value: number) => string,
) {
  return helper.accessor((row) => ratio(row) ?? undefined, {
    id,
    header: label,
    sortUndefined: 'last',
    sortDescFirst: true,
    meta: { align: 'right' },
    cell: (info) => {
      const value = info.getValue()
      return value === undefined ? <Missing /> : <span className="figures">{format(value)}</span>
    },
  })
}

function AppName({ app, range }: { app: AppRow['app']; range: RangeKey }) {
  return (
    <span className="flex items-center gap-3">
      <span
        className="grid size-7 shrink-0 place-items-center rounded-md border border-line bg-paper text-xs font-semibold"
        aria-hidden="true"
      >
        {app.name.charAt(0)}
      </span>
      <Link
        to="/apps/$appId"
        params={{ appId: app.id }}
        search={{ range }}
        className="hover:underline hover:underline-offset-4"
      >
        {app.name}
      </Link>
    </span>
  )
}

function StageLabel({ swatch, children }: { swatch: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`size-2 rounded-full ${swatch}`} aria-hidden="true" />
      {children}
    </span>
  )
}

/** No source reported this: a dash, and no comparison to make. */
function Missing() {
  return (
    <span className="text-ink-faint">
      <NoData />
    </span>
  )
}
