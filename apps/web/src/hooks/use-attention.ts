import { useQuery } from '@tanstack/react-query'
import { brokenIntegrations, waitingAssets } from '@/lib/attention'
import { accountsQuery, assetsQuery } from '@/lib/queries'

/**
 * The live counts. Both lists are shared with the Settings pages, which refresh them after a
 * change, so the counts follow without a reload. Until both have arrived there is no count at
 * all: half of one would be a wrong number, not an early one.
 */
export function useAttention() {
  const { data: assets } = useQuery(assetsQuery())
  const { data: families } = useQuery(accountsQuery())
  if (!assets || !families) return { waiting: [], broken: [], total: 0 }
  const waiting = waitingAssets(assets)
  const broken = brokenIntegrations(families)
  return { waiting, broken, total: waiting.length + broken.length }
}
