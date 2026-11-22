import { Link } from '@tanstack/react-router'
import { change, formatCount, formatMoney, formatRatio, per } from '../lib/format'
import type { Overview } from '../lib/queries'
import type { RangeKey } from '../lib/range'
import { Delta } from './Delta'
import { TABLE, TD, TH, THEAD_ROW, TR } from './ui/table'

export function AppsTable({ apps, range }: { apps: Overview['apps']; range: RangeKey }) {
  const rows = [...apps].sort((a, b) => b.totals.revenue - a.totals.revenue)

  return (
    <div className="overflow-x-auto">
      <table className={`${TABLE} min-w-[720px]`}>
        <thead>
          <tr className={THEAD_ROW}>
            <th scope="col" className={TH}>
              App
            </th>
            <StageHeader swatch="bg-views">Social views</StageHeader>
            <StageHeader swatch="bg-downloads">Downloads</StageHeader>
            <StageHeader swatch="bg-revenue">Revenue</StageHeader>
            <th scope="col" className={`${TH} text-right`}>
              Downloads per 1,000 views
            </th>
            <th scope="col" className={`${TH} text-right`}>
              Revenue per download
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ app, totals, previous, comparable }) => {
            const downloadsPerThousandViews = per(totals.downloads * 1000, totals.socialViews)
            const revenuePerDownload = per(totals.revenue, totals.downloads)
            return (
              <tr key={app.id} className={`${TR} align-middle`}>
                <th scope="row" className={`${TD} text-left font-medium`}>
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
                </th>
                <Metric
                  value={formatCount(totals.socialViews)}
                  delta={comparable ? change(totals.socialViews, previous.socialViews) : 'unknown'}
                />
                <Metric
                  value={formatCount(totals.downloads)}
                  delta={comparable ? change(totals.downloads, previous.downloads) : 'unknown'}
                />
                <Metric
                  value={formatMoney(totals.revenue)}
                  delta={comparable ? change(totals.revenue, previous.revenue) : 'unknown'}
                />
                <td className={`${TD} figures text-right`}>
                  {downloadsPerThousandViews === null ? '–' : formatRatio(downloadsPerThousandViews)}
                </td>
                <td className={`${TD} figures text-right`}>
                  {revenuePerDownload === null ? '–' : formatMoney(revenuePerDownload)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function StageHeader({ swatch, children }: { swatch: string; children: React.ReactNode }) {
  return (
    <th scope="col" className={`${TH} text-right`}>
      <span className="inline-flex items-center gap-2">
        <span className={`size-2 rounded-full ${swatch}`} aria-hidden="true" />
        {children}
      </span>
    </th>
  )
}

function Metric({ value, delta }: { value: string; delta: ReturnType<typeof change> | 'unknown' }) {
  return (
    <td className={`${TD} text-right`}>
      <span className="figures block font-medium">{value}</span>
      <span className="block text-xs">
        {delta === 'unknown' ? (
          <span className="text-ink-soft">not enough history</span>
        ) : (
          <Delta change={delta} />
        )}
      </span>
    </td>
  )
}
