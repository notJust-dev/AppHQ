import '@tanstack/react-start/server-only'
import { TRPCClientError } from '@trpc/client'

/** A redirect to a path on this dashboard. */
export const redirectTo = (path: string) => new Response(null, { status: 302, headers: { location: path } })

/**
 * What to say when the provider sent back an error instead of a code. Only a short, checked
 * error code is ever shown, so a crafted link cannot put its own words on the page.
 */
export function providerErrorMessage(provider: string, error: string): string {
  const code = /^[a-z_]{1,40}$/.test(error) ? error : 'unknown'
  return code === 'access_denied'
    ? `The ${provider} sign-in was cancelled, so nothing was connected.`
    : `${provider} could not complete the sign-in (${code}). Try again.`
}

/** The API's own message for a problem with the connection, or a generic line otherwise. */
export function callbackError(err: unknown): string {
  const code: unknown = err instanceof TRPCClientError ? err.data?.code : undefined
  const passOn = code === 'BAD_REQUEST' || code === 'PRECONDITION_FAILED'
  return passOn && err instanceof Error ? err.message : 'Could not reach the API. Try again.'
}
