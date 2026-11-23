import type { Change } from '@/lib/format'
import { cn } from '@/lib/utils'

const WORDS = { up: 'up', down: 'down', flat: 'no change' } as const

/**
 * Change against the previous period: green when it moved the good way, red when it moved the
 * bad way, grey when flat or new. Which way is good depends on the metric, so `better` says it:
 * 'up' (the default) for counts and money, 'down' for something like search position, and
 * 'neither' where a rise is not clearly good or bad, such as the number of reviews. The arrow
 * and the spoken wording carry the direction too, so the colour is never the only signal.
 */
export function Delta({ change, better = 'up' }: { change: Change | null; better?: 'up' | 'down' | 'neither' }) {
  if (!change) return <span className="text-muted-foreground">no data</span>

  const spoken =
    change.label === 'new'
      ? 'new this period'
      : change.direction === 'flat'
        ? WORDS.flat
        : `${WORDS[change.direction]} ${change.label}`

  const moved = change.direction !== 'flat' && change.label !== 'new' && better !== 'neither'
  const good = moved && change.direction === better
  const tone = !moved ? 'text-muted-foreground' : good ? 'text-positive' : 'text-negative'

  return (
    <span className={cn('figures inline-flex items-center gap-1 font-medium', tone)} aria-label={spoken}>
      {change.direction !== 'flat' && (
        <svg viewBox="0 0 8 8" className="size-2 fill-current" aria-hidden="true">
          {change.direction === 'up' ? <path d="M4 1 7.5 7h-7z" /> : <path d="M4 7 .5 1h7z" />}
        </svg>
      )}
      <span aria-hidden="true">{change.label}</span>
    </span>
  )
}
