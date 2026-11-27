import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod'
import { CONNECTED_PAGES } from '@/lib/integration-pages'

/**
 * Settings opens on Apps. Before Settings had pages, `/settings` was the page of the
 * connections, and the first sign-ins came back to it as `?connected=tiktok`; those go to their
 * integration's page, which reads the outcome.
 */
export const Route = createFileRoute('/_app/settings/')({
  validateSearch: z.object({ connected: z.enum(['tiktok', 'meta', 'youtube']).optional().catch(undefined) }),
  beforeLoad: ({ search }) => {
    if (search.connected) throw redirect({ to: CONNECTED_PAGES[search.connected], search, replace: true })
    throw redirect({ to: '/settings/apps', search, replace: true })
  },
})
