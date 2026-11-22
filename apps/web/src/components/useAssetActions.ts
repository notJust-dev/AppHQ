import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { assignAssetFn, ignoreAssetFn } from '../fns/assets'

type Action =
  | { type: 'assign'; assetId: string; appId: string | null }
  | { type: 'ignore'; assetId: string; ignored: boolean }

/**
 * Linking, unlinking and ignoring assets, with one line saying how the last one went. Linking
 * fetches the asset's history in the background, so the numbers follow a little later.
 */
export function useAssetActions() {
  const queryClient = useQueryClient()
  const assign = useServerFn(assignAssetFn)
  const ignore = useServerFn(ignoreAssetFn)
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null)

  const mutation = useMutation({
    mutationFn: (action: Action) =>
      action.type === 'assign'
        ? assign({ data: { assetId: action.assetId, appId: action.appId } })
        : ignore({ data: { assetId: action.assetId, ignored: action.ignored } }),
    onSuccess: async (result, action) => {
      if (!result.ok) {
        setNotice({ ok: false, message: result.message })
        return
      }
      setNotice(
        action.type === 'assign' && action.appId !== null
          ? { ok: true, message: 'Linked. Its history is being fetched; the charts fill in within a few minutes.' }
          : { ok: true, message: 'Saved.' },
      )
      // The apps, the assets and every chart can change with a link.
      await queryClient.invalidateQueries()
    },
    onError: () => setNotice({ ok: false, message: 'Could not save that. Try again.' }),
  })

  return {
    assign: (assetId: string, appId: string | null) => mutation.mutate({ type: 'assign', assetId, appId }),
    ignore: (assetId: string, ignored: boolean) => mutation.mutate({ type: 'ignore', assetId, ignored }),
    pending: mutation.isPending,
    notice,
  }
}

export type AssetActions = ReturnType<typeof useAssetActions>
