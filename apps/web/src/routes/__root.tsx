import type { QueryClient } from '@tanstack/react-query'
import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  createRootRouteWithContext,
  type ErrorComponentProps,
} from '@tanstack/react-router'
import type { ReactNode } from 'react'
import appCss from '../styles.css?url'

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'AppDashboard' },
      // A private tool: keep it out of search engines.
      { name: 'robots', content: 'noindex, nofollow' },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  component: RootComponent,
  errorComponent: RootError,
  notFoundComponent: NotFound,
})

function NotFound() {
  return (
    <main className="mx-auto max-w-xl px-6 py-24">
      <h1 className="font-display text-2xl font-semibold">This page does not exist</h1>
      <p className="mt-3 text-ink-soft">
        The address may be mistyped, or the page may have moved.{' '}
        <Link to="/" className="font-medium text-ink underline">
          Go to the portfolio
        </Link>
      </p>
    </main>
  )
}

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  )
}

function RootError({ error }: ErrorComponentProps) {
  return (
    <RootDocument>
      <main className="mx-auto max-w-xl px-6 py-24">
        <h1 className="font-display text-2xl font-semibold">The dashboard could not load</h1>
        <p className="mt-3 text-ink-soft">
          Something on the server is not set up or not reachable. Check the dashboard's
          environment variables and that the API is running, then reload.
        </p>
        {/* The detail can name configuration, so it is shown in development only. In production
            it is in the server log. */}
        {import.meta.env.DEV && (
          <pre className="mt-6 overflow-x-auto rounded-md border border-line bg-surface p-4 text-sm">
            {error instanceof Error ? error.message : String(error)}
          </pre>
        )}
      </main>
    </RootDocument>
  )
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body className="min-h-screen">
        {children}
        <Scripts />
      </body>
    </html>
  )
}
