import { useState } from 'react'
import { SourceLogo } from '@/components/SourceLogo'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import type { SignInProvider } from '@/fns/account'

const PROVIDER_NAMES: Record<SignInProvider, string> = { google: 'Google', github: 'GitHub' }

/** Codes Better Auth sends back with a failed sign-in; only these get their own words. */
const ERRORS: Record<string, string> = {
  account_not_linked: 'That address already has an account, made with the other sign-in. Use that one instead.',
  email_not_verified: 'Your provider has not confirmed that address yet. Confirm it there, then try again.',
  access_denied: 'The sign-in was cancelled.',
}
const SIGN_IN_FAILED = 'The sign-in did not finish. Try again.'

/**
 * "Continue with Google / GitHub", for the providers this server has. Better Auth answers with
 * the provider's sign-in address and sends the browser back to `/request-access`, or back to
 * the login page with an error code.
 */
export function SocialSignIn({ providers, error }: { providers: SignInProvider[]; error?: string }) {
  const [pending, setPending] = useState<SignInProvider | null>(null)
  const [failed, setFailed] = useState(false)

  const start = async (provider: SignInProvider) => {
    setPending(provider)
    setFailed(false)
    try {
      const response = await fetch('/api/auth/sign-in/social', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider, callbackURL: '/request-access', errorCallbackURL: '/login' }),
      })
      const { url } = (await response.json()) as { url?: string }
      if (!response.ok || !url) throw new Error('no sign-in address')
      window.location.assign(url)
    } catch {
      setFailed(true)
      setPending(null)
    }
  }

  const problem = failed ? SIGN_IN_FAILED : error ? (ERRORS[error] ?? SIGN_IN_FAILED) : null
  return (
    <div className="flex flex-col gap-2">
      {problem && (
        <Alert variant="destructive" className="mb-2">
          <AlertDescription>{problem}</AlertDescription>
        </Alert>
      )}
      {providers.map((provider) => (
        <Button key={provider} variant="outline" size="lg" disabled={pending !== null} onClick={() => start(provider)}>
          {pending === provider ? <Spinner /> : <SourceLogo source={provider} decorative />}
          Continue with {PROVIDER_NAMES[provider]}
        </Button>
      ))}
    </div>
  )
}
