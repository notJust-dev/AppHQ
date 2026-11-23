import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import type { inferRouterInputs } from '@trpc/server'
// Type-only: erased at build time.
import type { AppRouter } from '../../../api/src/trpc/router'
import { api } from '@/server/api'
import { joinWaitlist } from '@/server/waitlist'

/**
 * Public: anyone on the landing page can call it, so it takes no session. `website` is a field
 * people never see; a bot that fills it in is thanked, nothing is stored, and it gets no token.
 */
export const joinWaitlistFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
      website: z.string().max(200).optional(),
    }),
  )
  .handler(async ({ data }) => {
    if (data.website) return { result: 'ok' as const, answerToken: null }
    return joinWaitlist(data.email)
  })

export type WaitlistAnswers = inferRouterInputs<AppRouter>['waitlist']['answer']['answers']

/**
 * Public too, but it only writes to the sign-up the token was handed out for. The page calls it
 * on every change with just what changed, so unfinished answers are kept. The API checks each
 * answer against its list, so this only bounds the size.
 */
export const answerWaitlistFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      answerToken: z.uuid(),
      answers: z.record(z.string(), z.unknown()).refine((value) => JSON.stringify(value).length < 4000),
      completed: z.boolean().optional(),
    }),
  )
  .handler(async ({ data }) => {
    await api().waitlist.answer.mutate({
      answerToken: data.answerToken,
      answers: data.answers as WaitlistAnswers,
      completed: data.completed,
    })
    return { ok: true as const }
  })
