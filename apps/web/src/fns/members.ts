import { createServerFn } from '@tanstack/react-start'
import { TRPCClientError } from '@trpc/client'
import { z } from 'zod'
import { requireDashboardAccess } from './auth'

export const MEMBER_ROLES = ['owner', 'admin', 'member'] as const
export type MemberRole = (typeof MEMBER_ROLES)[number]

/**
 * The API words its refusals of member changes for the person (who may do what, an address that
 * already belongs), so those are passed on. Anything else gets a generic line.
 */
function messageFrom(err: unknown): string {
  if (err instanceof TRPCClientError) {
    const code: unknown = err.data?.code
    if (code === 'BAD_REQUEST' || code === 'PRECONDITION_FAILED' || code === 'FORBIDDEN' || code === 'NOT_FOUND') return err.message
  }
  return 'Could not reach the API.'
}

async function attempt<T>(work: () => Promise<T>) {
  try {
    return { ok: true as const, ...(await work()) }
  } catch (err) {
    return { ok: false as const, message: messageFrom(err) }
  }
}

/** Who belongs to the organization, and its open invitations; `{ accounts: false }` with accounts off. */
export const listMembersFn = createServerFn({ method: 'GET' })
  .middleware([requireDashboardAccess])
  .handler(({ context }) => context.api.members.list.query())

export const inviteMemberFn = createServerFn({ method: 'POST' })
  .middleware([requireDashboardAccess])
  .validator(z.object({ email: z.string().trim().min(3).max(254), role: z.enum(MEMBER_ROLES) }))
  .handler(({ data, context }) => attempt(() => context.api.members.invite.mutate(data)))

export const cancelInvitationFn = createServerFn({ method: 'POST' })
  .middleware([requireDashboardAccess])
  .validator(z.object({ invitationId: z.string().min(1).max(64) }))
  .handler(({ data, context }) => attempt(() => context.api.members.cancelInvitation.mutate(data)))

export const removeMemberFn = createServerFn({ method: 'POST' })
  .middleware([requireDashboardAccess])
  .validator(z.object({ memberId: z.string().min(1).max(64) }))
  .handler(({ data, context }) => attempt(() => context.api.members.remove.mutate(data)))

export const setMemberRoleFn = createServerFn({ method: 'POST' })
  .middleware([requireDashboardAccess])
  .validator(z.object({ memberId: z.string().min(1).max(64), role: z.enum(MEMBER_ROLES) }))
  .handler(({ data, context }) => attempt(() => context.api.members.setRole.mutate(data)))
