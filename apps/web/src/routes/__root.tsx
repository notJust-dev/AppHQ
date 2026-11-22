import type { QueryClient } from '@tanstack/react-query'
import {
  HeadContent,
  Link,
  Outlet,
  ScriptOnce,
  Scripts,
  createRootRouteWithContext,
  type ErrorComponentProps,
} from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { ErrorPage } from '../components/ErrorPage'
import { THEME_SCRIPT } from '../lib/theme'
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
  // An error in the root route itself replaces the whole document, so it brings its own shell.
  errorComponent: RootError,
  notFoundComponent: NotFound,
})

function NotFound() {
  return (
    <main className="mx-auto max-w-md px-6 py-24">
      <h1 className="text-xl font-semibold tracking-tight">This page does not exist</h1>
      <p className="mt-2 text-ink-soft">
        The address may be mistyped, or the page may have moved.{' '}
        <Link to="/" className="font-medium text-ink underline underline-offset-4">
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

function RootError(props: ErrorComponentProps) {
  return (
    <RootDocument>
      <ErrorPage {...props} />
    </RootDocument>
  )
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    // The theme script may set data-theme before React takes over; that is expected.
    <html lang="en" suppressHydrationWarning>
      <head>
        <ScriptOnce>{THEME_SCRIPT}</ScriptOnce>
        <HeadContent />
      </head>
      <body className="min-h-screen">
        {children}
        <Scripts />
      </body>
    </html>
  )
}
