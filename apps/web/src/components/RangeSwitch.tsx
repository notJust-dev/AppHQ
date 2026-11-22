import { Link } from '@tanstack/react-router'
import { RANGE_KEYS, RANGE_LABELS, type RangeKey } from '@/lib/range'

/**
 * The date range lives in the URL, so a view can be bookmarked, shared and reloaded. Links, not
 * buttons, for that reason; they wear shadcn/ui's tab list look.
 */
export function RangeSwitch({ current }: { current: RangeKey }) {
  return (
    <nav aria-label="Date range" className="inline-flex h-8 items-center rounded-lg bg-muted p-[3px] text-muted-foreground">
      {RANGE_KEYS.map((key) => (
        <Link
          key={key}
          // The current page, with only the range changed.
          to="."
          search={(previous) => ({ ...previous, range: key })}
          // TanStack marks the link to the address in view with aria-current="page".
          data-active={key === current}
          className="inline-flex h-full items-center rounded-md px-2.5 text-sm font-medium transition-colors hover:text-foreground data-[active=true]:bg-card data-[active=true]:text-foreground data-[active=true]:shadow-sm dark:data-[active=true]:bg-input"
        >
          {RANGE_LABELS[key]}
        </Link>
      ))}
    </nav>
  )
}
