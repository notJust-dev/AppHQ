import { change, formatCompact, formatMoney, formatRatio, per, type Change } from '@/lib/format'
import type { Overview } from '@/lib/queries'
import { Delta } from './Delta'
import { NoData } from '@/components/NoData'

type Totals = Overview['totals']
type Reporting = Overview['reporting']

/**
 * The portfolio as one funnel: views, downloads, revenue, with the conversion between each
 * pair sitting on the seam that joins them.
 */
export function FunnelBand({
  totals,
  previous,
  reporting,
}: {
  totals: Totals
  /** Null when history does not cover the previous period. */
  previous: Totals | null
  /** Which totals any source reported; the others are no data, not zero. */
  reporting: Reporting
}) {
  // A conversion needs both of its stages to have numbers.
  const downloadsPerThousandViews =
    reporting.socialViews && reporting.downloads ? per(totals.downloads * 1000, totals.socialViews) : null
  const revenuePerDownload = reporting.revenue && reporting.downloads ? per(totals.revenue, totals.downloads) : null

  return (
    // Laid out by the room it has, not the window, since the sidebar takes part of the window.
    <section aria-label="Funnel totals" className="@container">
      <div className="flex flex-col overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10 @2xl:flex-row">
      <Stage
        label="Social views"
        swatch="bg-views"
        value={reporting.socialViews ? formatCompact(totals.socialViews) : null}
        change={previous ? change(totals.socialViews, previous.socialViews) : 'incomparable'}
      />
      <Seam
        value={downloadsPerThousandViews === null ? '–' : formatRatio(downloadsPerThousandViews)}
        label="downloads per 1,000 views"
      />
      <Stage
        label="Downloads"
        swatch="bg-downloads"
        value={reporting.downloads ? formatCompact(totals.downloads) : null}
        change={previous ? change(totals.downloads, previous.downloads) : 'incomparable'}
      />
      <Seam
        value={revenuePerDownload === null ? '–' : formatMoney(revenuePerDownload)}
        label="revenue per download"
      />
      <Stage
        label="Revenue"
        swatch="bg-revenue"
        value={reporting.revenue ? formatMoney(totals.revenue) : null}
        change={previous ? change(totals.revenue, previous.revenue) : 'incomparable'}
      />
      </div>
    </section>
  )
}

function Stage(props: {
  label: string
  swatch: string
  /** Null when no source reported this stage in the range. */
  value: string | null
  /** Null when there is nothing in either period; 'incomparable' when history is too short. */
  change: Change | null | 'incomparable'
}) {
  return (
    <div className="relative flex-1 px-5 pt-5 pb-4">
      {/* The stage's colour along its top edge: which part of the funnel this is. */}
      <span className={`absolute inset-x-0 top-0 h-0.5 ${props.swatch}`} aria-hidden="true" />
      <p className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <span className={`size-2 rounded-full ${props.swatch}`} aria-hidden="true" />
        {props.label}
      </p>
      <p
        className={`figures mt-2 text-[32px] leading-none font-semibold tracking-tight ${
          props.value === null ? 'text-faint' : ''
        }`}
      >
        {props.value ?? <NoData />}
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        {props.value === null ? (
          'No data in this range'
        ) : props.change === 'incomparable' ? (
          'Not enough history to compare'
        ) : props.change === null ? (
          'No data yet'
        ) : (
          // The page header says what the change is against, so each card shows only the change.
          <Delta change={props.change} />
        )}
      </p>
    </div>
  )
}

function Seam({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex items-center gap-3 border-y bg-muted/50 px-5 py-2.5 @2xl:w-28 @2xl:flex-col @2xl:justify-center @2xl:gap-1 @2xl:border-x @2xl:border-y-0 @2xl:px-3 @2xl:text-center">
      <span className="figures text-[15px] font-semibold">{value}</span>
      <span className="text-[11px] leading-snug text-muted-foreground">{label}</span>
    </div>
  )
}
