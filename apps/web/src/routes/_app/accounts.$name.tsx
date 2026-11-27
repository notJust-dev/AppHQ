import { createFileRoute, redirect } from '@tanstack/react-router'
import { integrationPageFor } from '@/lib/integration-pages'

/**
 * `/accounts/tiktok` and its siblings became `/settings/integrations/tiktok` and so on. The query
 * string comes along: sign-ins from before this move come back with `?connected=` on the old
 * address.
 */
export const Route = createFileRoute('/_app/accounts/$name')({
  beforeLoad: ({ params, search }) => {
    throw redirect({ to: integrationPageFor(params.name), search, replace: true })
  },
})
