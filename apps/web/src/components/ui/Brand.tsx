/**
 * The mark: the funnel itself, three bars narrowing from views to downloads to revenue, in the
 * stage colours the charts use.
 */
export function BrandMark({ className = 'size-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} aria-hidden="true">
      <rect x="1" y="2.5" width="18" height="4" rx="2" fill="var(--color-views)" />
      <rect x="4" y="8" width="12" height="4" rx="2" fill="var(--color-downloads)" />
      <rect x="7" y="13.5" width="6" height="4" rx="2" fill="var(--color-revenue)" />
    </svg>
  )
}
