import { areaX, defineChart } from '@tanstack/charts'
import { Chart } from '@tanstack/charts/react'
import { scaleLinear } from '@tanstack/charts/scales/linear'
import { useMemo, type ReactNode } from 'react'
import { formatCount } from '@/lib/format'
import { cn } from '@/lib/utils'

/** The height of one stage, in pixels. The labels beside the shape use the same rows. */
const STAGE_HEIGHT = 64
/** The share of a stage left empty below it, so the stages read as steps. */
const GAP = 0.1
/** The narrowest stage keeps this share of the full width, so it never disappears. */
const MIN_WIDTH = 0.16

export interface FunnelStage {
  key: string
  label: string
  /**
   * Null for a stage this source does not report, kept so the stages below line up with another
   * funnel's: it is drawn faint and its value reads "–".
   */
  value: number | null
  /** A stage colour, as a CSS colour (usually a stage token). */
  color: string
  /** How this stage compares with the one before it. */
  rate?: ReactNode
}

/** The colour of a stage with no number. */
const MISSING_COLOR = 'var(--muted)'

/**
 * Each stage's width as a share of the full width, on a log scale over the stages with numbers.
 * A stage without one takes the width of the next stage that has one, so it reads as a step
 * that is there but not measured.
 */
function widthsOf(stages: FunnelStage[]): number[] {
  const logs = stages.map((stage) => (stage.value === null ? null : Math.log10(Math.max(stage.value, 1))))
  const known = logs.filter((value): value is number => value !== null)
  const top = Math.max(...known)
  const bottom = Math.min(...known)
  const widths = logs.map((value) =>
    value === null ? null : top === bottom ? 1 : MIN_WIDTH + ((1 - MIN_WIDTH) * (value - bottom)) / (top - bottom),
  )
  return widths.map((width, index) => width ?? widths.slice(index + 1).find((next) => next !== null) ?? 1)
}

const colorOf = (stage: FunnelStage) => (stage.value === null ? MISSING_COLOR : stage.color)

/**
 * A funnel: each stage a band narrowing into the next, with its label, total and rate beside
 * it. Stages often span orders of magnitude, so widths are on a log scale and the exact numbers
 * sit beside the shape. Needs two stages or more; the caller decides what to show otherwise.
 */
export function FunnelChart({ stages, ariaLabel = 'Funnel shape' }: { stages: FunnelStage[]; ariaLabel?: string }) {
  const definition = useMemo(() => {
    const widths = widthsOf(stages)
    // Each stage narrows from its own width at the top to the next stage's at the bottom.
    const rows = stages.flatMap((stage, index) => {
      const top = widths[index] ?? 1
      // A stage with no number stays as wide as it starts: there is no drop to show.
      const bottom = stage.value === null ? top : (widths[index + 1] ?? top * 0.86)
      return [
        { key: stage.key, color: colorOf(stage), y: index, left: -top / 2, right: top / 2 },
        { key: stage.key, color: colorOf(stage), y: index + 1 - GAP, left: -bottom / 2, right: bottom / 2 },
      ]
    })
    return defineChart({
      marks: [areaX(rows, { y: 'y', x1: 'left', x2: 'right', z: 'key', fill: (row) => row.color, fillOpacity: 0.9 })],
      scales: {
        x: { scale: scaleLinear().domain([-0.5, 0.5]), axis: false },
        y: { scale: scaleLinear().domain([0, stages.length]), reverse: true, axis: false },
      },
      guides: false,
      margin: 0,
    })
  }, [stages])

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-4">
      <div aria-hidden="true">
        <Chart definition={definition} height={stages.length * STAGE_HEIGHT} initialWidth={260} ariaLabel={ariaLabel} />
      </div>
      <ol className="grid" style={{ gridTemplateRows: `repeat(${stages.length}, ${STAGE_HEIGHT}px)` }}>
        {stages.map((stage) => (
          <li key={stage.key} className="flex min-w-0 flex-col justify-center" style={{ paddingBottom: `${GAP * STAGE_HEIGHT}px` }}>
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              <span aria-hidden="true" className="size-2.5 shrink-0 rounded-sm" style={{ background: colorOf(stage) }} />
              {stage.label}
            </span>
            <span className={cn('figures text-lg leading-tight font-semibold', stage.value === null && 'text-faint')}>
              {stage.value === null ? '–' : formatCount(stage.value)}
            </span>
            {stage.rate && <span className="truncate text-xs text-muted-foreground">{stage.rate}</span>}
          </li>
        ))}
      </ol>
    </div>
  )
}
