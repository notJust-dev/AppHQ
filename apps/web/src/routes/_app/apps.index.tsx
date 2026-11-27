import { createFileRoute, redirect } from '@tanstack/react-router'

/** The Apps page moved into Settings; old links and bookmarks land there, with what they carried. */
export const Route = createFileRoute('/_app/apps/')({
  beforeLoad: ({ search }) => {
    throw redirect({ to: '/settings/apps', search, replace: true })
  },
})
