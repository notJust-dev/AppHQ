import { Link } from '@tanstack/react-router'
import { change, formatCount, formatMoney, formatRatio, per } from '../lib/format'
import type { Overview } from '../lib/queries'
import type { RangeKey } from '../lib/range'
import { Delta } from './Delta'

export function AppsTable({ apps, range }: { apps: Overview['apps']; range: RangeKey }) {
  const rows = [...apps].sort((a, b) => b.totals.revenue - a.totals.revenue)

  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-line text-left text-ink-soft">
            <th scope="col" className="px-6 py-3 font-medium">
              App
            </th>
            <StageHeader swatch="bg-views">Social views</StageHeader>
            <StageHeader swatch="bg-downloads">Downloads</StageHeader>
            <StageHeader swatch="bg-revenue">Revenue</StageHeader>
            <th scope="col" className="px-6 py-3 text-right font-medium">
              Downloads per 1,000 views
            </th>
            <th scope="col" className="px-6 py-3 text-right font-medium">
              Revenue per download
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ app, totals, previous, comparable }) => {
            const downloadsPerThousandViews = per(totals.downloads * 1000, totals.socialViews)
            const revenuePerDownload = per(totals.revenue, totals.downloads)
            return (
              <tr key={app.id} className="border-b border-line last:border-b-0">
                <th scope="row" className="px-6 py-4 text-left font-medium">
                  <span className="flex items-center gap-3">
                    <span
                      className="grid size-8 shrink-0 place-items-center rounded-md border border-line bg-paper font-display text-sm font-semibold"
                      aria-hidden="true"
                    >
                      {app.name.charAt(0)}
                    </span>
                    <Link
                      to="/apps/$appId"
                      params={{ appId: app.id }}
                      search={{ range }}
                      className="underline decoration-line underline-offset-4 hover:decoration-ink"
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
                <td className="figures px-6 py-4 text-right">
                  {downloadsPerThousandViews === null ? '–' : formatRatio(downloadsPerThousandViews)}
                </td>
                <td className="figures px-6 py-4 text-right">
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
    <th scope="col" className="px-6 py-3 text-right font-medium whitespace-nowrap">
      <span className="inline-flex items-center gap-2">
        <span className={`size-2.5 rounded-[3px] ${swatch}`} aria-hidden="true" />
        {children}
      </span>
    </th>
  )
}

function Metric({ value, delta }: { value: string; delta: ReturnType<typeof change> | 'unknown' }) {
  return (
    <td className="px-6 py-4 text-right">
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
