import '@tanstack/react-start/server-only'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
// Type-only: erased at build time, so this app never bundles or depends on the API's code.
import type { AppRouter } from '../../../api/src/trpc/router'
import { serverEnv } from './env'

let client: ReturnType<typeof createTRPCClient<AppRouter>> | undefined

/**
 * Typed client for the API, for use inside server functions only. The internal token stays on
 * the server; the browser talks to this app's server functions, never to the API.
 */
export function api() {
  client ??= createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `${serverEnv().API_URL}/trpc`,
        headers: () => ({ authorization: `Bearer ${serverEnv().INTERNAL_API_TOKEN}` }),
      }),
    ],
  })
  return client
}
