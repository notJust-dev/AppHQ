import { Link, createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { CheckCircle2, Clock } from 'lucide-react'
import { useState } from 'react'
import { BrandMark, BrandName } from '@/components/Brand'
import { PublicFooter } from '@/components/Legal'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { getAccountFn, requestAccessFn, type AccountView } from '@/fns/account'
import { getSessionFn } from '@/fns/auth'
import { formatDay } from '@/lib/format'

/**
 * Where people with an account end up after signing in on /login or signing up, until they
 * have dashboard access. They can ask for access and see that they did. Signed out, it sends them
 * to /login; with access, to the dashboard.
 *
 * Reading the account makes an approved account its organization the first time (see the API's
 * `account.get`), so an account approved since its last visit goes on to the dashboard from here.
 */
export const Route = createFileRoute('/request-access')({
  loader: async () => {
    const { account } = await getAccountFn()
    if (!account) throw redirect({ to: '/login' })
    if (account.accessStatus === 'approved' && (await getSessionFn()).dashboardAccess) throw redirect({ to: '/' })
    return { account }
  },
  head: () => ({ meta: [{ title: 'Request access · AppHQ' }] }),
  component: RequestAccessPage,
})

function RequestAccessPage() {
  const { account } = Route.useLoaderData()

  return (
    <div className="flex min-h-screen flex-col">
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 pb-16">
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
            <SignedIn account={account} />
          </CardContent>
        </Card>
      </main>
      <PublicFooter />
    </div>
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
            {current.accessStatus === 'approved' ? (
              // Approved, yet still here: the dashboard could not be opened a moment ago.
              <Link to="/" className="text-muted-foreground underline underline-offset-4 hover:text-foreground">
                Open the dashboard
              </Link>
            ) : (
              <span className="text-muted-foreground">
                {`${current.accessRequestedAt ? `Asked ${formatDay(current.accessRequestedAt.slice(0, 10))}. ` : ''}We will email ${current.email} when your account is ready.`}
              </span>
            )}
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
