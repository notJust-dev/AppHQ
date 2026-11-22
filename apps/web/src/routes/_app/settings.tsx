import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod'

/** Settings became Accounts; old links and bookmarks land there, with what they carried. */
export const Route = createFileRoute('/_app/settings')({
  validateSearch: z.object({ connected: z.enum(['tiktok', 'meta']).optional().catch(undefined) }),
  beforeLoad: ({ search }) => {
    throw redirect({ to: '/accounts', search })
  },
})
