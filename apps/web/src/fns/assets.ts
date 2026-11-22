import { createServerFn } from '@tanstack/react-start'
import { TRPCClientError } from '@trpc/client'
import { z } from 'zod'
import { api } from '../server/api'
import { requireSession } from './auth'

/** The API's own message for a problem with what was chosen; a generic line otherwise. */
function messageFrom(err: unknown, fallback: string): string {
  if (err instanceof TRPCClientError && err.data?.code === 'BAD_REQUEST') return err.message
  return fallback
}

export const listAssetsFn = createServerFn({ method: 'GET' })
  .middleware([requireSession])
  .handler(() => api().assets.list.query())

/** Gives an asset to an app, to a new app ('new'), to the portfolio ('portfolio'), or to none. */
export const assignAssetFn = createServerFn({ method: 'POST' })
  .middleware([requireSession])
  .validator(z.object({ assetId: z.uuid(), appId: z.string().min(1).max(64).nullable() }))
  .handler(async ({ data }) => {
    try {
      return { ok: true as const, ...(await api().assets.assign.mutate(data)) }
    } catch (err) {
      return { ok: false as const, message: messageFrom(err, 'Could not save that. Try again.') }
    }
  })

export const ignoreAssetFn = createServerFn({ method: 'POST' })
  .middleware([requireSession])
  .validator(z.object({ assetId: z.uuid(), ignored: z.boolean() }))
  .handler(async ({ data }) => {
    try {
      await api().assets.ignore.mutate(data)
      return { ok: true as const }
    } catch (err) {
      return { ok: false as const, message: messageFrom(err, 'Could not save that. Try again.') }
    }
  })

export const createAppFn = createServerFn({ method: 'POST' })
  .middleware([requireSession])
  .validator(z.object({ name: z.string().trim().min(1).max(80) }))
  .handler(async ({ data }) => {
    try {
      return { ok: true as const, ...(await api().apps.create.mutate(data)) }
    } catch (err) {
      return { ok: false as const, message: messageFrom(err, 'Could not add the app. Try again.') }
    }
  })
