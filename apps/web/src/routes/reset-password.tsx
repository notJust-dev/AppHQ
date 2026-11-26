import { Link, createFileRoute, redirect } from '@tanstack/react-router'
import { useLayoutEffect, useState } from 'react'
import { AuthPage, TextLink } from '@/components/AuthPage'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { getAccountFn } from '@/fns/account'
import { MIN_PASSWORD_LENGTH, PROBLEMS, resetPassword, type Problem } from '@/lib/email-auth'

/**
 * Where the link in the reset email leads: choosing a new password.
 *
 * The link's token comes after the `#`, which browsers never send to a server, so it is in no
 * request log. This page takes it out of the address bar as soon as it has read it, before the
 * analytics start (they record page addresses), so it is neither recorded nor left in the
 * browser's history.
 */
export const Route = createFileRoute('/reset-password')({
  loader: async () => {
    const { email } = await getAccountFn()
    if (!email) throw redirect({ to: '/login' })
    return null
  },
  head: () => ({ meta: [{ title: 'Choose a new password · AppHQ' }] }),
  component: ResetPasswordPage,
})

/**
 * The token of the link this page was opened with. Kept here and not in the component, because
 * it can be read from the address only once: the page may mount more than once (React does so on
 * purpose in development), and by then the address no longer has it.
 */
let tokenFromLink: string | null = null

/** The token from the address, removed from it; null when no link brought one. */
function takeToken(): string | null {
  const found = new URLSearchParams(window.location.hash.slice(1)).get('token')
  if (window.location.hash) {
    // The router's own state is kept, so going back and forward still works.
    window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
  }
  if (found) tokenFromLink = found
  return tokenFromLink
}

/** Once a token is used up or refused, it is forgotten. */
function forgetToken() {
  tokenFromLink = null
}

function ResetPasswordPage() {
  /** Undefined until the address has been read, in the browser. */
  const [token, setToken] = useState<string | null | undefined>(undefined)
  const [password, setPassword] = useState('')
  const [problem, setProblem] = useState<Problem | null>(null)
  const [pending, setPending] = useState(false)
  const [done, setDone] = useState(false)

  // A layout effect runs before every ordinary effect, so before the analytics start.
  useLayoutEffect(() => setToken(takeToken()), [])

  const below = (
    <p>
      <TextLink to="/login">Back to sign in</TextLink>
    </p>
  )

  if (done) {
    return (
      <AuthPage title="Password changed">
        <p role="status" className="text-muted-foreground">
          Your new password is set, and your account was signed out everywhere.
        </p>
        <Button asChild size="lg" className="w-full">
          <Link to="/login">Sign in</Link>
        </Button>
      </AuthPage>
    )
  }

  if (token === null || problem === 'link') {
    return (
      <AuthPage title="This link does not work" below={below}>
        <p className="text-muted-foreground">
          A reset link works once and for a limited time, and only the newest one counts. Ask for another and use it
          straight away.
        </p>
        <Button asChild size="lg" className="w-full">
          <Link to="/forgot-password">Send a new link</Link>
        </Button>
      </AuthPage>
    )
  }

  return (
    <AuthPage title="Choose a new password" below={below}>
      <form
        className="flex flex-col gap-4"
        onSubmit={async (event) => {
          event.preventDefault()
          if (!token) return
          if (password.length < MIN_PASSWORD_LENGTH) return setProblem('short')
          setPending(true)
          setProblem(null)
          const outcome = await resetPassword(token, password)
          setPending(false)
          if (outcome.ok || outcome.problem === 'link') forgetToken()
          if (outcome.ok) setDone(true)
          else setProblem(outcome.problem)
        }}
      >
        <Field data-invalid={problem !== null}>
          <FieldLabel htmlFor="new-password">New password</FieldLabel>
          <Input
            id="new-password"
            name="password"
            type="password"
            autoComplete="new-password"
            autoFocus
            required
            value={password}
            onChange={(event) => {
              setPassword(event.target.value)
              setProblem(null)
            }}
            aria-invalid={problem !== null}
            aria-describedby={problem ? 'reset-problem' : undefined}
          />
          {/* The length rule is not shown up front; a password that is too short says so here. */}
          {problem && <FieldError id="reset-problem">{PROBLEMS[problem]}</FieldError>}
        </Field>
        <Button type="submit" size="lg" disabled={pending || token === undefined} className="w-full">
          {pending && <Spinner />}
          {pending ? 'Saving…' : 'Save the new password'}
        </Button>
      </form>
    </AuthPage>
  )
}
