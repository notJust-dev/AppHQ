import { areaX, defineChart } from '@tanstack/charts'
import { Chart } from '@tanstack/charts/react'
import { scaleLinear } from '@tanstack/charts/scales/linear'
import { useMemo, type ReactNode } from 'react'
import { NoData } from '@/components/NoData'
import { formatCount } from '@/lib/format'
import type { AppFlow } from '@/lib/queries'

/** The height of one stage, in pixels. The labels beside the shape use the same rows. */
const STAGE_HEIGHT = 64
/** The share of a stage left empty below it, so the stages read as steps. */
const GAP = 0.1
/** The narrowest stage keeps this share of the full width, so it never disappears. */
const MIN_WIDTH = 0.16

interface Stage {
  key: string
  label: string
  value: number
  /** A stage colour token, as in the timeline above. */
  color: string
  /** How this stage compares with the one before it. */
  rate?: ReactNode
}

const percent = (part: number, whole: number) => `${((part / whole) * 100).toFixed(whole >= 1000 ? 1 : 0)}%`

/** The stages this app has numbers for, in funnel order, each with its rate from the one before. */
function stagesOf(flow: AppFlow): Stage[] {
  const views = flow.socialViews.total
  const downloads = flow.downloads.total
  const trials = flow.trials
  const { converted, running } = flow.trialOutcomes
  const stages: Stage[] = []
  if (views !== null) {
    stages.push({ key: 'views', label: 'Social views', value: views, color: 'var(--views)' })
  }
  if (downloads !== null) {
    stages.push({
      key: 'downloads',
      label: 'Downloads',
      value: downloads,
      color: 'var(--downloads)',
      rate: views ? `${formatCount(Math.round((downloads / views) * 1000 * 10) / 10)} per 1,000 views` : undefined,
    })
  }
  if (trials !== null) {
    stages.push({
      key: 'trials',
      label: 'Trials started',
      value: trials,
      color: 'color-mix(in oklab, var(--revenue) 55%, var(--card))',
      rate: downloads ? `${percent(trials, downloads)} as many as downloads` : undefined,
    })
  }
  if (converted !== null) {
    stages.push({
      key: 'converted',
      label: 'Trials converted',
      value: converted,
      color: 'var(--revenue)',
      rate: trials ? (
        <>
          {percent(converted, trials)} of trials{running ? ` · ${formatCount(running)} running` : ''}
        </>
      ) : undefined,
    })
  }
  return stages
}

/** Whether the app has numbers for two stages or more, which a funnel needs. */
export const canDrawFunnel = (flow: AppFlow) => stagesOf(flow).length >= 2

/** Each stage's width as a share of the full width, on a log scale. */
function widthsOf(stages: Stage[]): number[] {
  const logs = stages.map((stage) => Math.log10(Math.max(stage.value, 1)))
  const top = Math.max(...logs)
  const bottom = Math.min(...logs)
  return logs.map((value) => (top === bottom ? 1 : MIN_WIDTH + ((1 - MIN_WIDTH) * (value - bottom)) / (top - bottom)))
}

/**
 * The app's way from attention to paying over the range: social views, downloads, trials and
 * the trials that converted. The stages span orders of magnitude (thousands of views for each
 * subscriber), so widths are on a log scale and the exact numbers sit beside them.
 */
export function AppFunnel({ flow }: { flow: AppFlow }) {
  const stages = useMemo(() => stagesOf(flow), [flow])

  const definition = useMemo(() => {
    const widths = widthsOf(stages)
    // Each stage narrows from its own width at the top to the next stage's at the bottom.
    const rows = stages.flatMap((stage, index) => {
      const top = widths[index] ?? 1
      const bottom = widths[index + 1] ?? top * 0.86
      return [
        { key: stage.key, color: stage.color, y: index, left: -top / 2, right: top / 2 },
        { key: stage.key, color: stage.color, y: index + 1 - GAP, left: -bottom / 2, right: bottom / 2 },
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

  if (stages.length < 2) {
    return <NoData label="A funnel needs two stages or more. Link a social account or a RevenueCat project in Settings." />
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-4">
      <div aria-hidden="true">
        <Chart definition={definition} height={stages.length * STAGE_HEIGHT} initialWidth={260} ariaLabel="Funnel shape" />
      </div>
      <ol className="grid" style={{ gridTemplateRows: `repeat(${stages.length}, ${STAGE_HEIGHT}px)` }}>
        {stages.map((stage) => (
          <li key={stage.key} className="flex min-w-0 flex-col justify-center" style={{ paddingBottom: `${GAP * STAGE_HEIGHT}px` }}>
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              <span aria-hidden="true" className="size-2.5 shrink-0 rounded-sm" style={{ background: stage.color }} />
              {stage.label}
            </span>
            <span className="figures text-lg leading-tight font-semibold">{formatCount(stage.value)}</span>
            {stage.rate && <span className="truncate text-xs text-muted-foreground">{stage.rate}</span>}
          </li>
        ))}
      </ol>
    </div>
  )
}
