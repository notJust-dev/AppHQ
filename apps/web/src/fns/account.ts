import { createServerFn } from '@tanstack/react-start'
import { TRPCClientError } from '@trpc/client'
import { accountApi, publicApi } from '@/server/api'
import { hasAccountCookie } from '@/server/accounts'

export type SignInProvider = 'google' | 'github'

export interface AccountView {
  email: string
  name: string
  accessStatus: 'requested' | 'approved' | null
  accessRequestedAt: string | null
}

/**
 * Public: how people can sign in here (none when accounts are off), and the visitor's own account
 * when they are signed in to one. It never says anything about anyone else, and it never opens
 * the dashboard, which takes the dashboard password. If the API can't be reached, the visitor is
 * treated as signed out, so the public pages still load.
 */
export const getAccountFn = createServerFn({ method: 'GET' }).handler(async () => {
  const providers: SignInProvider[] = await publicApi()
    .account.config.query()
    .then((config) => config.providers)
    .catch(() => [])
  if (providers.length === 0 || !hasAccountCookie()) return { providers, account: null }
  const account: AccountView | null = await accountApi()
    .account.get.query()
    .catch(() => null)
  return { providers, account }
})

/** For a signed-in account only: the API checks its session. Asking again changes nothing. */
export const requestAccessFn = createServerFn({ method: 'POST' }).handler(async () => {
  try {
    return { ok: true as const, account: (await accountApi().account.requestAccess.mutate()) as AccountView }
  } catch (err) {
    const signedOut = err instanceof TRPCClientError && err.data?.code === 'UNAUTHORIZED'
    return { ok: false as const, message: signedOut ? 'Sign in again, then ask.' : 'Could not reach the server. Try again.' }
  }
})
