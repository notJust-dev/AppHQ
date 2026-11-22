import type { Change } from '@/lib/format'

const WORDS = { up: 'up', down: 'down', flat: 'no change' } as const

/**
 * Change against the previous period. Direction is carried by the arrow and the wording, not by
 * colour: whether "up" is good depends on the metric, and the stage colours are taken.
 */
export function Delta({ change }: { change: Change | null }) {
  if (!change) return <span className="text-muted-foreground">no data</span>

  const spoken =
    change.label === 'new'
      ? 'new this period'
      : change.direction === 'flat'
        ? WORDS.flat
        : `${WORDS[change.direction]} ${change.label}`

  return (
    <span className="figures inline-flex items-center gap-1 text-muted-foreground" aria-label={spoken}>
      {change.direction !== 'flat' && (
        <svg viewBox="0 0 8 8" className="size-2 fill-current" aria-hidden="true">
          {change.direction === 'up' ? <path d="M4 1 7.5 7h-7z" /> : <path d="M4 7 .5 1h7z" />}
        </svg>
      )}
      <span aria-hidden="true">{change.label}</span>
    </span>
  )
}
