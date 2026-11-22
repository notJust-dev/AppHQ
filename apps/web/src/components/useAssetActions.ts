import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { toast } from 'sonner'
import { assignAssetFn, ignoreAssetsFn } from '@/fns/assets'

type Action =
  | { type: 'assign'; assetId: string; appId: string | null }
  | { type: 'ignore'; assetIds: string[]; ignored: boolean }

/**
 * Linking, unlinking and ignoring assets, each saying in a toast how it went. Linking fetches
 * the asset's history in the background, so the numbers follow a little later.
 */
export function useAssetActions() {
  const queryClient = useQueryClient()
  const assign = useServerFn(assignAssetFn)
  const ignore = useServerFn(ignoreAssetsFn)

  const mutation = useMutation({
    mutationFn: async (action: Action): Promise<{ ok: true } | { ok: false; message: string }> =>
      action.type === 'assign'
        ? assign({ data: { assetId: action.assetId, appId: action.appId } })
        : ignore({ data: { assetIds: action.assetIds, ignored: action.ignored } }),
    onSuccess: async (result, action) => {
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success(noticeFor(action))
      // The apps, the assets and every chart can change with a link.
      await queryClient.invalidateQueries()
    },
    onError: () => toast.error('Could not save that. Try again.'),
  })

  return {
    assign: (assetId: string, appId: string | null) => mutation.mutate({ type: 'assign', assetId, appId }),
    ignore: (assetIds: string[], ignored: boolean) => mutation.mutate({ type: 'ignore', assetIds, ignored }),
    pending: mutation.isPending,
  }
}

export type AssetActions = ReturnType<typeof useAssetActions>

function noticeFor(action: Action): string {
  if (action.type === 'ignore') {
    const count = action.assetIds.length
    if (!action.ignored) return count === 1 ? 'Restored. It waits for a decision again.' : `Restored ${count}.`
    return count === 1 ? 'Ignored. You can restore it from the Ignored list.' : `Ignored ${count}. You can restore them from the Ignored list.`
  }
  if (action.appId === null) return 'Removed from the app. It waits for a decision again.'
  if (action.appId === 'new') return 'App added. Its history is being fetched; the charts fill in within a few minutes.'
  return 'Linked. Its history is being fetched; the charts fill in within a few minutes.'
}
