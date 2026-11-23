import type { CSSProperties } from 'react'
import { BrandMark } from '@/components/Brand'
import { SourceLogo } from '@/components/SourceLogo'
import { BRAND_LOGOS } from '@/lib/brand-logos'
import { cn } from '@/lib/utils'

/**
 * The sources around the ring, clockwise from the top, each with the funnel stage it feeds. A
 * stage's colour is the one the dashboard uses for it, so the dots that flow in mean the same
 * thing they mean inside.
 */
const SOURCES: { source: string; stage: 'views' | 'downloads' | 'revenue' }[] = [
  { source: 'tiktok', stage: 'views' },
  { source: 'instagram', stage: 'views' },
  { source: 'app_store', stage: 'downloads' },
  { source: 'revenuecat', stage: 'revenue' },
  { source: 'google_play', stage: 'downloads' },
  { source: 'search_console', stage: 'views' },
  { source: 'youtube', stage: 'views' },
  { source: 'facebook', stage: 'views' },
]

/** How far the ring sits from the centre, as a share of the box (the box is 100 units across). */
const RADIUS = 38
/** One trip of a dot from a source to the centre. */
const FLOW_SECONDS = 3.2

const round = (n: number) => Math.round(n * 100) / 100

const NODES = SOURCES.map((item, i) => {
  const angle = (i / SOURCES.length) * 2 * Math.PI - Math.PI / 2
  return { ...item, dx: round(RADIUS * Math.cos(angle)), dy: round(RADIUS * Math.sin(angle)) }
})

/**
 * The landing page's picture: AppHQ in the middle, every source it reads around it, and data
 * flowing in along the lines. The motion is decoration only; it stops for people who ask their
 * system for less motion (see `.hub-flow` and `.hub-pulse` in styles.css).
 */
export function ConnectionsHub({ className }: { className?: string }) {
  const names = NODES.map((node) => BRAND_LOGOS[node.source]?.title ?? node.source)
  return (
    <figure
      role="img"
      aria-label={`AppHQ brings together ${names.slice(0, -1).join(', ')} and ${names.at(-1)}.`}
      className={cn('relative aspect-square w-full select-none', className)}
    >
      <svg viewBox="-50 -50 100 100" className="absolute inset-0 size-full overflow-visible" aria-hidden="true">
        {NODES.map((node) => (
          <line
            key={node.source}
            x1={node.dx}
            y1={node.dy}
            x2={0}
            y2={0}
            stroke="var(--border)"
            strokeWidth={0.4}
            strokeDasharray="1.2 1.2"
          />
        ))}
        {NODES.map((node, i) => (
          <circle
            key={node.source}
            r={1.1}
            className="hub-flow"
            fill={`var(--${node.stage})`}
            style={
              {
                '--from-x': `${node.dx}px`,
                '--from-y': `${node.dy}px`,
                animationDuration: `${FLOW_SECONDS}s`,
                // Spread the starts over one trip, so dots arrive one after another.
                animationDelay: `${round((i / NODES.length) * FLOW_SECONDS)}s`,
              } as CSSProperties
            }
          />
        ))}
      </svg>

      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" aria-hidden="true">
        <div className="hub-pulse absolute inset-0 rounded-[22%] bg-primary" />
        <BrandMark className="relative size-20 drop-shadow-sm sm:size-24" />
      </div>

      {NODES.map((node) => (
        <div
          key={node.source}
          aria-hidden="true"
          className="absolute flex size-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-xl border bg-card shadow-sm sm:size-13"
          style={{ left: `${50 + node.dx}%`, top: `${50 + node.dy}%` }}
        >
          <SourceLogo source={node.source} decorative className="size-5 sm:size-6" />
        </div>
      ))}
    </figure>
  )
}
