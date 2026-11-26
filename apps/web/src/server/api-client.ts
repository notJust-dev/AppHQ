import '@tanstack/react-start/server-only'
import { createTRPCClient, httpLink } from '@trpc/client'
// Type-only: erased at build time, so this app never bundles or depends on the API's code.
import type { AppRouter } from '../../../api/src/trpc/router'
import { serverEnv } from './env'

/**
 * How this server tells the API that the visitor signed in with the dashboard password. The API
 * accepts it only while its ALLOW_DASHBOARD_PASSWORD is on. Must match apps/api/src/trpc/init.ts.
 */
export const ACCESS_HEADER = 'x-apphq-access'
export const DASHBOARD_ACCESS = 'dashboard'

/**
 * A client for one call. Each carries its own visitor's headers, so calls from two visitors can
 * never travel together in one batch. The internal token stays on this server; the browser talks
 * to this app's server functions, never to the API.
 */
export function apiClient(headers: Record<string, string>) {
  const env = serverEnv()
  return createTRPCClient<AppRouter>({
    links: [httpLink({ url: `${env.API_URL}/trpc`, headers: { authorization: `Bearer ${env.INTERNAL_API_TOKEN}`, ...headers } })],
  })
}

export type Api = ReturnType<typeof apiClient>
