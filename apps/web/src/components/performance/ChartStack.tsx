import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Daily charts stacked on one shared day axis, each under a short label: small multiples of one
 * story, such as posts, then views, then downloads.
 */
export function ChartStack({ children }: { children: ReactNode }) {
  return <div className="divide-y">{children}</div>
}

export function ChartRow(props: { label: string; swatch: string; summary?: ReactNode; children: ReactNode }) {
  return (
    <div className="px-5 pt-4 pb-1">
      <p className="flex flex-wrap items-baseline gap-x-2 text-sm font-medium">
        <span className={cn('size-2 shrink-0 translate-y-[-1px] self-center rounded-full', props.swatch)} aria-hidden="true" />
        {props.label}
        {props.summary && <span className="font-normal text-muted-foreground">{props.summary}</span>}
      </p>
      {props.children}
    </div>
  )
}
