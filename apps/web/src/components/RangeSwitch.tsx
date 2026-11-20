import { Link } from '@tanstack/react-router'
import { RANGE_KEYS, RANGE_LABELS, type RangeKey } from '../lib/range'

/** The date range lives in the URL, so a view can be bookmarked, shared and reloaded. */
export function RangeSwitch({ current }: { current: RangeKey }) {
  return (
    <nav aria-label="Date range" className="inline-flex rounded-md border border-line bg-surface p-0.5">
      {RANGE_KEYS.map((key) => {
        const active = key === current
        return (
          <Link
            key={key}
            to="/"
            search={{ range: key }}
            aria-current={active ? 'true' : undefined}
            className={`rounded px-3 py-1.5 text-sm font-medium ${
              active ? 'bg-ink text-surface' : 'text-ink-soft hover:text-ink'
            }`}
          >
            {RANGE_LABELS[key]}
          </Link>
        )
      })}
    </nav>
  )
}
