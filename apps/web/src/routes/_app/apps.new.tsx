import { createFileRoute, redirect } from '@tanstack/react-router'

/** Adding an app moved into Settings; old links and bookmarks land there. */
export const Route = createFileRoute('/_app/apps/new')({
  beforeLoad: ({ search }) => {
    throw redirect({ to: '/settings/apps/new', search, replace: true })
  },
})
