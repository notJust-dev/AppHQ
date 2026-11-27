import { createFileRoute, redirect } from '@tanstack/react-router'

/** An app's numbers live on Overview with the app chosen; old links and bookmarks go there. */
export const Route = createFileRoute('/_app/apps/$appId/')({
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/', search: (previous) => ({ ...previous, app: params.appId }), replace: true })
  },
})
