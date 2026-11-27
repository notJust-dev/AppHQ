import { createFileRoute, redirect } from '@tanstack/react-router'

/** An app's settings moved into Settings; old links and bookmarks land there. */
export const Route = createFileRoute('/_app/apps/$appId/settings')({
  beforeLoad: ({ params, search }) => {
    throw redirect({ to: '/settings/apps/$appId', params, search, replace: true })
  },
})
