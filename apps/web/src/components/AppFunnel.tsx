import { useMemo } from 'react'
import { FunnelChart, type FunnelStage } from '@/components/FunnelChart'
import { NoData } from '@/components/NoData'
import { formatCount } from '@/lib/format'
import type { AppFlow } from '@/lib/queries'

const percent = (part: number, whole: number) => `${((part / whole) * 100).toFixed(whole >= 1000 ? 1 : 0)}%`

/** The stages this app has numbers for, in funnel order, each with its rate from the one before. */
function stagesOf(flow: AppFlow): FunnelStage[] {
  const views = flow.socialViews.total
  const downloads = flow.downloads.total
  const trials = flow.trials
  const { converted, running } = flow.trialOutcomes
  const stages: FunnelStage[] = []
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

/**
 * The app's way from attention to paying over the range: social views, downloads, trials and
 * the trials that converted.
 */
export function AppFunnel({ flow }: { flow: AppFlow }) {
  const stages = useMemo(() => stagesOf(flow), [flow])
  if (stages.length < 2) {
    return <NoData label="A funnel needs two stages or more. Link a social account or a RevenueCat project in Settings." />
  }
  return <FunnelChart stages={stages} />
}
