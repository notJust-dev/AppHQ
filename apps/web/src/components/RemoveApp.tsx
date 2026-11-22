import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { removeAppFn } from '../fns/assets'
import { Button } from './Button'

declare module '@tanstack/react-router' {
  interface HistoryState {
    /** The app just removed, for the Apps page to say so. Kept out of the address on purpose. */
    removedApp?: string
  }
}

/** Stops tracking an app, after saying plainly what goes and what stays. */
export function RemoveApp(props: { appId: string; name: string }) {
  const remove = useServerFn(removeAppFn)
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [confirming, setConfirming] = useState(false)
  const mutation = useMutation({
    mutationFn: () => remove({ data: { appId: props.appId } }),
    onSuccess: async (result) => {
      if (!result.ok) return
      await navigate({ to: '/apps', state: { removedApp: result.name } })
      void queryClient.invalidateQueries()
    },
  })
  const result = mutation.data

  return (
    <section className="rounded-lg border border-danger/40 bg-surface" aria-labelledby="remove-heading">
      <div className="px-5 py-4">
      <h2 id="remove-heading" className="text-[15px] font-semibold tracking-tight">
        Stop tracking
      </h2>
      <p className="mt-1 max-w-prose text-[13px] text-ink-soft">
        Removes {props.name} from the dashboard, with its numbers and posts. Its store apps, project
        and accounts stay connected and wait on the Apps page, so you can add it again later. Its
        history is fetched again then, except TikTok&apos;s daily views, which TikTok does not keep.
      </p>
      {confirming ? (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-md bg-danger-soft px-4 py-3 text-[13px]">
          <span className="font-medium text-danger">Remove {props.name}?</span>
          <Button variant="danger" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? 'Removing…' : 'Remove app'}
          </Button>
          <Button disabled={mutation.isPending} onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <div className="mt-4">
          <Button variant="dangerOutline" onClick={() => setConfirming(true)}>
            Remove this app
          </Button>
        </div>
      )}
      <div role="status" className="mt-3 text-[13px] text-danger empty:hidden">
        {mutation.isError && 'Could not reach the dashboard server. Try again.'}
        {result && !result.ok && result.message}
      </div>
      </div>
    </section>
  )
}
