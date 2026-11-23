import type { ReactNode } from 'react'
import { Delta } from '@/components/Delta'
import { NoData } from '@/components/NoData'
import { change } from '@/lib/format'
import { cn } from '@/lib/utils'

/** A row of headline numbers, as many per line as the room allows. */
export function StatGrid({ children, columns = 3 }: { children: ReactNode; columns?: 3 | 4 }) {
  return (
    <section aria-label="Totals" className="@container">
      <div className={cn('grid grid-cols-1 gap-3 @md:grid-cols-2', columns === 4 ? '@3xl:grid-cols-4' : '@2xl:grid-cols-3')}>
        {children}
      </div>
    </section>
  )
}

/**
 * One headline number with how it moved against the period before. `previous` null means the
 * period before had no data to compare with; `value` null means no source reported this.
 */
export function Stat(props: {
  label: string
  value: number | null
  previous?: number | null
  format: (value: number) => string
  /** A stage colour token, as a Tailwind background class, e.g. `bg-views`. */
  swatch?: string
  /** Said under the number instead of a comparison, e.g. what it is out of. */
  hint?: string
  /** Whether a rise is the kind of change shown; levels such as MRR compare their latest values. */
  compared?: boolean
  /** Which way of moving is good; 'down' for something like search position. */
  better?: 'up' | 'down'
}) {
  const comparable = props.compared !== false && props.value !== null && props.previous !== undefined && props.previous !== null
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-xl bg-card px-4 py-3.5 ring-1 ring-foreground/10">
      <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        {props.swatch && <span className={cn('size-2 shrink-0 rounded-full', props.swatch)} aria-hidden="true" />}
        <span className="truncate">{props.label}</span>
      </p>
      <p className={cn('figures text-2xl leading-none font-semibold tracking-tight', props.value === null && 'text-faint')}>
        {props.value === null ? <NoData /> : props.format(props.value)}
      </p>
      <p className="text-xs text-muted-foreground">
        {props.value === null ? (
          'No data in this range'
        ) : comparable ? (
          <>
            <Delta change={change(props.value!, props.previous!)} better={props.better} /> vs previous period
          </>
        ) : (
          (props.hint ?? 'Nothing to compare with')
        )}
      </p>
    </div>
  )
}
