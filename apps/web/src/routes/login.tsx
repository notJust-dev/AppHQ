import { Link, createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { z } from 'zod'
import { BrandMark, BrandName } from '@/components/Brand'
import { EmailSignIn } from '@/components/EmailSignIn'
import { SocialSignIn } from '@/components/SocialSignIn'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { getAccountFn } from '@/fns/account'
import { getSessionFn, signInFn } from '@/fns/auth'

/**
 * Every way in. Google, GitHub and an email address with a password, when this server has them,
 * lead to an account: an approved member goes on to the dashboard, anyone else to the Request
 * access page. The dashboard password, when this server has one, is a separate block; without
 * DASHBOARD_PASSWORD it isn't shown at all.
 */
export const Route = createFileRoute('/login')({
  // Better Auth sends a failed sign-in back here with an error code.
  validateSearch: z.object({ error: z.string().max(60).optional().catch(undefined) }),
  beforeLoad: async () => {
    const { dashboardAccess, passwordEnabled } = await getSessionFn()
    if (dashboardAccess) throw redirect({ to: '/' })
    return { passwordEnabled }
  },
  loader: async ({ context }) => {
    const { providers, email, account } = await getAccountFn()
    if (account) throw redirect({ to: '/request-access' })
    return { providers, email, passwordEnabled: context.passwordEnabled }
  },
  component: LoginPage,
})

function LoginPage() {
  const { providers, email, passwordEnabled } = Route.useLoaderData()
  const { error } = Route.useSearch()
  const accounts = providers.length > 0 || email

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 pb-24">
      <p className="flex items-center gap-2.5">
        <BrandMark className="size-8" />
        <BrandName className="text-lg" />
      </p>
      <Card className="mt-8 [--card-spacing:--spacing(6)]">
        <CardHeader>
          <CardTitle>
            <h1 className="text-xl font-semibold tracking-tight">Sign in</h1>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {providers.length > 0 && <SocialSignIn providers={providers} error={error} />}
          {providers.length > 0 && email && <Or />}
          {email && <EmailSignIn autoFocus={providers.length === 0} />}
          {accounts && passwordEnabled && <Or />}
          {/* With accounts off, this is the whole page, exactly as before. */}
          {passwordEnabled && <PasswordSignIn alone={!accounts} />}
          {!accounts && !passwordEnabled && (
            <p className="text-muted-foreground">
              No way to sign in is set up on this server. Set DASHBOARD_PASSWORD on the dashboard, or
              turn on accounts on the API, as the README describes.
            </p>
          )}
        </CardContent>
      </Card>
      {/* Signing in to an account is the consent the privacy policy relies on. */}
      {accounts && (
        <p className="mt-6 text-center text-sm text-balance text-muted-foreground">
          By continuing, you agree to the{' '}
          <Link to="/terms" className="font-medium underline underline-offset-4 hover:text-foreground">
            Terms
          </Link>{' '}
          and{' '}
          <Link to="/privacy" className="font-medium underline underline-offset-4 hover:text-foreground">
            Privacy policy
          </Link>
          .
        </p>
      )}
    </main>
  )
}

/** The line between two ways to sign in. */
function Or() {
  return (
    <p className="flex items-center gap-3 text-xs text-faint before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border">
      or
    </p>
  )
}

const MESSAGES = {
  wrong: 'That password is not correct.',
  locked: 'Too many attempts. Try again in 10 minutes.',
  off: 'Signing in with a password is off here.',
} as const

/** The dashboard password, when this server has one. */
function PasswordSignIn({ alone }: { alone: boolean }) {
  const router = useRouter()
  const signIn = useServerFn(signInFn)
  const [password, setPassword] = useState('')
  const [problem, setProblem] = useState<keyof typeof MESSAGES | null>(null)
  const [pending, setPending] = useState(false)

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault()
        setPending(true)
        try {
          const { result } = await signIn({ data: { password } })
          if (result === 'ok') {
            await router.navigate({ to: '/' })
          } else {
            setProblem(result)
          }
        } finally {
          setPending(false)
        }
      }}
    >
      <Field data-invalid={problem !== null}>
        <FieldLabel htmlFor="password">{alone ? 'Password' : 'Dashboard password'}</FieldLabel>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          autoFocus={alone}
          required
          value={password}
          onChange={(event) => {
            setPassword(event.target.value)
            setProblem(null)
          }}
          aria-invalid={problem !== null}
          aria-describedby={problem ? 'password-problem' : undefined}
        />
        {problem && <FieldError id="password-problem">{MESSAGES[problem]}</FieldError>}
      </Field>
      <Button type="submit" size="lg" disabled={pending} className="mt-5 w-full">
        {pending && <Spinner />}
        {pending ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  )
}
