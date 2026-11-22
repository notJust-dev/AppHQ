import type { ErrorComponentProps } from '@tanstack/react-router'

/**
 * Shown for any error a route does not handle itself. The detail can describe the server, so it
 * appears in development only; in production it is in the server log.
 */
export function ErrorPage({ error }: ErrorComponentProps) {
  return (
    <main className="mx-auto max-w-md px-6 py-24">
      <h1 className="text-xl font-semibold tracking-tight">The dashboard could not load</h1>
      <p className="mt-2 text-muted-foreground">
        Something on the server is not set up or not reachable. Check the dashboard's environment
        variables and that the API is running, then reload.
      </p>
      {import.meta.env.DEV && (
        <pre className="mt-6 overflow-x-auto rounded-lg border bg-card p-4 font-mono text-xs">
          {error instanceof Error ? error.message : String(error)}
        </pre>
      )}
    </main>
  )
}
