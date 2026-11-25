import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { CheckCircle2, Clock } from 'lucide-react'
import { useState } from 'react'
import { z } from 'zod'
import { BrandMark, BrandName } from '@/components/Brand'
import { PublicFooter } from '@/components/Legal'
import { SourceLogo } from '@/components/SourceLogo'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { getAccountFn, requestAccessFn, type AccountView, type SignInProvider } from '@/fns/account'
import { formatDay } from '@/lib/format'

/**
 * Where people with an account (Google or GitHub) end up. They can ask for access and see that
 * they did; nothing else. The dashboard itself still takes the dashboard password at /login.
 */
export const Route = createFileRoute('/request-access')({
  // Better Auth sends people back here with an error code; only known codes get their own words.
  validateSearch: z.object({ error: z.string().max(60).optional().catch(undefined) }),
  loader: () => getAccountFn(),
  head: () => ({ meta: [{ title: 'Request access · AppHQ' }] }),
  component: RequestAccessPage,
})

const PROVIDER_NAMES: Record<SignInProvider, string> = { google: 'Google', github: 'GitHub' }

const ERRORS: Record<string, string> = {
  account_not_linked:
    'That address already has an account, made with the other sign-in. Use that one instead.',
  email_not_verified: 'Your provider has not confirmed that address yet. Confirm it there, then try again.',
  access_denied: 'The sign-in was cancelled.',
}
const SIGN_IN_FAILED = 'The sign-in did not finish. Try again.'

function RequestAccessPage() {
  const { providers, account } = Route.useLoaderData()
  const { error } = Route.useSearch()

  return (
    <div className="flex min-h-screen flex-col">
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 pb-16">
        <Link to="/" className="flex items-center gap-2.5 self-start">
          <BrandMark className="size-8" />
          <BrandName className="text-lg" />
        </Link>
        <Card className="mt-8 [--card-spacing:--spacing(6)]">
          <CardHeader>
            <CardTitle>
              <h1 className="text-xl font-semibold tracking-tight">Request access</h1>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            {error && !account && (
              <Alert variant="destructive">
                <AlertDescription>{ERRORS[error] ?? SIGN_IN_FAILED}</AlertDescription>
              </Alert>
            )}
            {account ? (
              <SignedIn account={account} />
            ) : providers.length > 0 ? (
              <SignInOptions providers={providers} />
            ) : (
              <p className="text-muted-foreground">Accounts are not open on this server.</p>
            )}
          </CardContent>
        </Card>
        <p className="mt-6 text-sm text-faint">
          Running this dashboard yourself?{' '}
          <Link to="/login" className="underline underline-offset-4 hover:text-foreground">
            Sign in with its password
          </Link>
        </p>
      </main>
      <PublicFooter />
    </div>
  )
}

function SignInOptions({ providers }: { providers: SignInProvider[] }) {
  const [pending, setPending] = useState<SignInProvider | null>(null)
  const [failed, setFailed] = useState(false)

  const start = async (provider: SignInProvider) => {
    setPending(provider)
    setFailed(false)
    try {
      // Better Auth answers with the provider's sign-in address; it sends the browser back here.
      const response = await fetch('/api/auth/sign-in/social', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider, callbackURL: '/request-access', errorCallbackURL: '/request-access' }),
      })
      const { url } = (await response.json()) as { url?: string }
      if (!response.ok || !url) throw new Error('no sign-in address')
      window.location.assign(url)
    } catch {
      setFailed(true)
      setPending(null)
    }
  }

  return (
    <>
      <p className="text-muted-foreground">
        AppHQ is opening to a few people at a time. Sign in to ask for access, and we will email
        you when your account is ready.
      </p>
      <div className="flex flex-col gap-2">
        {providers.map((provider) => (
          <Button key={provider} variant="outline" size="lg" disabled={pending !== null} onClick={() => start(provider)}>
            {pending === provider ? <Spinner /> : <SourceLogo source={provider} decorative />}
            Continue with {PROVIDER_NAMES[provider]}
          </Button>
        ))}
      </div>
      {failed && <p className="text-sm text-destructive">{SIGN_IN_FAILED}</p>}
    </>
  )
}

function SignedIn({ account }: { account: AccountView }) {
  const router = useRouter()
  const requestAccess = useServerFn(requestAccessFn)
  const [current, setCurrent] = useState(account)
  const [pending, setPending] = useState<'request' | 'sign-out' | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const ask = async () => {
    setPending('request')
    setProblem(null)
    try {
      const result = await requestAccess()
      if (result.ok) setCurrent(result.account)
      else setProblem(result.message)
    } catch {
      setProblem('Could not reach the server. Try again.')
    } finally {
      setPending(null)
    }
  }

  const signOut = async () => {
    setPending('sign-out')
    try {
      await fetch('/api/auth/sign-out', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    } finally {
      await router.invalidate()
      setPending(null)
    }
  }

  return (
    <>
      <p className="text-muted-foreground">
        Signed in as <span className="font-medium text-foreground">{current.email}</span>.
      </p>
      {current.accessStatus === null ? (
        <>
          <p className="text-muted-foreground">
            AppHQ is opening to a few people at a time. Ask, and we will email you when your account
            is ready.
          </p>
          <Button size="lg" disabled={pending !== null} onClick={ask}>
            {pending === 'request' && <Spinner />}
            {pending === 'request' ? 'Asking…' : 'Request access'}
          </Button>
        </>
      ) : (
        <p role="status" className="flex items-start gap-3 rounded-lg border bg-card p-4">
          {current.accessStatus === 'approved' ? (
            <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-[var(--downloads)]" />
          ) : (
            <Clock className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          )}
          <span>
            <span className="font-medium">
              {current.accessStatus === 'approved' ? 'You are approved.' : 'You have asked for access.'}
            </span>{' '}
            <span className="text-muted-foreground">
              {current.accessStatus === 'approved'
                ? `We will email ${current.email} as soon as your account opens.`
                : `${current.accessRequestedAt ? `Asked ${formatDay(current.accessRequestedAt.slice(0, 10))}. ` : ''}We will email ${current.email} when your account is ready.`}
            </span>
          </span>
        </p>
      )}
      {problem && <p className="text-sm text-destructive">{problem}</p>}
      <Button variant="ghost" disabled={pending !== null} onClick={signOut} className="self-start">
        {pending === 'sign-out' && <Spinner />}
        Sign out
      </Button>
    </>
  )
}
