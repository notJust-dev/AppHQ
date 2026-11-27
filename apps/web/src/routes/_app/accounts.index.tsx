import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod'
import { CONNECTED_PAGES } from '@/lib/integration-pages'

/**
 * Accounts became Settings › Integrations; old links and bookmarks land there, with what they
 * carried. Sign-ins from before the integrations had pages came back here as `?connected=`; their
 * integration's page reads the outcome.
 */
export const Route = createFileRoute('/_app/accounts/')({
  validateSearch: z.object({ connected: z.enum(['tiktok', 'meta', 'youtube']).optional().catch(undefined) }),
  beforeLoad: ({ search }) => {
    if (search.connected) throw redirect({ to: CONNECTED_PAGES[search.connected], search, replace: true })
    throw redirect({ to: '/settings/integrations', search, replace: true })
  },
})
