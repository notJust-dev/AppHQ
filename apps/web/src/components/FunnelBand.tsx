import { change, formatCompact, formatMoney, formatRatio, per, type Change } from '../lib/format'
import type { Overview } from '../lib/queries'
import { Delta } from './Delta'

type Totals = Overview['totals']

/**
 * The portfolio as one funnel: views, downloads, revenue, with the conversion between each
 * pair sitting on the seam that joins them.
 */
export function FunnelBand({
  totals,
  previous,
  comparedWith,
}: {
  totals: Totals
  /** Null when history does not cover the previous period. */
  previous: Totals | null
  comparedWith: string
}) {
  const downloadsPerThousandViews = per(totals.downloads * 1000, totals.socialViews)
  const revenuePerDownload = per(totals.revenue, totals.downloads)

  return (
    <section
      aria-label="Funnel totals"
      className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface lg:flex-row"
    >
      <Stage
        label="Social views"
        swatch="bg-views"
        value={formatCompact(totals.socialViews)}
        change={previous ? change(totals.socialViews, previous.socialViews) : 'incomparable'}
        comparedWith={comparedWith}
      />
      <Seam
        value={downloadsPerThousandViews === null ? '–' : formatRatio(downloadsPerThousandViews)}
        label="downloads per 1,000 views"
      />
      <Stage
        label="Downloads"
        swatch="bg-downloads"
        value={formatCompact(totals.downloads)}
        change={previous ? change(totals.downloads, previous.downloads) : 'incomparable'}
        comparedWith={comparedWith}
      />
      <Seam
        value={revenuePerDownload === null ? '–' : formatMoney(revenuePerDownload)}
        label="revenue per download"
      />
      <Stage
        label="Revenue"
        swatch="bg-revenue"
        value={formatMoney(totals.revenue)}
        change={previous ? change(totals.revenue, previous.revenue) : 'incomparable'}
        comparedWith={comparedWith}
      />
    </section>
  )
}

function Stage(props: {
  label: string
  swatch: string
  value: string
  /** Null when there is nothing in either period; 'incomparable' when history is too short. */
  change: Change | null | 'incomparable'
  comparedWith: string
}) {
  return (
    <div className="flex-1 px-6 py-5">
      <p className="flex items-center gap-2 text-sm font-medium">
        <span className={`size-2.5 rounded-[3px] ${props.swatch}`} aria-hidden="true" />
        {props.label}
      </p>
      <p className="figures mt-2 font-display text-4xl font-semibold tracking-tight">
        {props.value}
      </p>
      <p className="mt-1 text-sm text-ink-soft">
        {props.change === 'incomparable' ? (
          'Not enough history to compare'
        ) : props.change === null ? (
          'No data yet'
        ) : (
          <>
            <Delta change={props.change} /> <span>{props.comparedWith}</span>
          </>
        )}
      </p>
    </div>
  )
}

function Seam({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex items-center gap-3 border-y border-line bg-paper px-6 py-3 lg:w-36 lg:flex-col lg:justify-center lg:gap-1 lg:border-x lg:border-y-0 lg:px-3 lg:text-center">
      <span className="figures font-display text-xl font-semibold">{value}</span>
      <span className="text-xs leading-snug text-ink-soft">{label}</span>
    </div>
  )
}
