import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { Private } from '@/components/Private'
import { removeAppFn } from '@/fns/assets'

/** Stops tracking an app, after saying plainly what goes and what stays. */
export function RemoveApp(props: { appId: string; name: string }) {
  const remove = useServerFn(removeAppFn)
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const mutation = useMutation({
    mutationFn: () => remove({ data: { appId: props.appId } }),
    onSuccess: async (result) => {
      if (!result.ok) return
      setOpen(false)
      await navigate({ to: '/settings/apps' })
      toast.success(
        <span>
          Removed <Private>{result.name}</Private>. What fed it waits on the Apps page, to add again or ignore.
        </span>,
      )
      void queryClient.invalidateQueries()
    },
  })
  const result = mutation.data
  const problem = mutation.isError
    ? 'Could not reach the dashboard server. Try again.'
    : result && !result.ok
      ? result.message
      : null

  return (
    <Card className="gap-0 py-0 ring-destructive/30 [--card-spacing:--spacing(5)]" role="region" aria-labelledby="remove-heading">
      <CardHeader className="py-4">
        <CardTitle>
          <h2 id="remove-heading">Stop tracking</h2>
        </CardTitle>
        <CardDescription className="max-w-prose">
          Removes <Private>{props.name}</Private> from the dashboard, with its numbers and posts. Its store apps,
          project and accounts stay connected and wait on the Apps page, so you can add it again
          later. Its history is fetched again then, except TikTok&apos;s daily views, which TikTok
          does not keep.
        </CardDescription>
      </CardHeader>
      <CardFooter className="justify-end border-destructive/20 bg-destructive-soft/40 py-3">
        <AlertDialog
          open={open}
          onOpenChange={(next) => {
            // Stays open while the removal runs, so its outcome has somewhere to show.
            if (!mutation.isPending) setOpen(next)
            if (!next) mutation.reset()
          }}
        >
          <AlertDialogTrigger asChild>
            <Button variant="destructive">Remove this app</Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Remove <Private>{props.name}</Private>?
              </AlertDialogTitle>
              <AlertDialogDescription>
                Its numbers and posts leave the dashboard. What feeds it stays connected and waits on
                the Apps page.
              </AlertDialogDescription>
            </AlertDialogHeader>
            {problem && (
              <p role="alert" className="text-sm text-destructive">
                {problem}
              </p>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={mutation.isPending}>Cancel</AlertDialogCancel>
              {/* A plain button, not the dialog's action, so the dialog waits for the result. */}
              <Button variant="destructive" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
                {mutation.isPending && <Spinner />}
                {mutation.isPending ? 'Removing…' : 'Remove app'}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardFooter>
    </Card>
  )
}
