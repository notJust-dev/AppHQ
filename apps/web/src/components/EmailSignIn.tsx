import { Link, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { PROBLEMS, signInWithEmail, type Problem } from '@/lib/email-auth'

/**
 * Signing in with an email address and a password, for accounts made on /sign-up. Like the
 * Google and GitHub buttons it leads to the Request access page, which sends a member
 * on to the dashboard.
 */
export function EmailSignIn({ autoFocus }: { autoFocus: boolean }) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [problem, setProblem] = useState<Problem | null>(null)
  const [pending, setPending] = useState(false)

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (event) => {
        event.preventDefault()
        setPending(true)
        setProblem(null)
        const outcome = await signInWithEmail(email.trim(), password)
        if (outcome.ok) {
          await router.invalidate()
          await router.navigate({ to: '/request-access' })
        } else {
          setProblem(outcome.problem)
          setPending(false)
        }
      }}
    >
      <Field>
        <FieldLabel htmlFor="email">Email</FieldLabel>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          autoFocus={autoFocus}
          required
          value={email}
          onChange={(event) => {
            setEmail(event.target.value)
            setProblem(null)
          }}
        />
      </Field>
      <Field data-invalid={problem !== null}>
        <FieldLabel htmlFor="account-password">Password</FieldLabel>
        <Input
          id="account-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => {
            setPassword(event.target.value)
            setProblem(null)
          }}
          aria-invalid={problem !== null}
          aria-describedby={problem ? 'email-sign-in-problem' : undefined}
        />
        {problem && <FieldError id="email-sign-in-problem">{PROBLEMS[problem]}</FieldError>}
        {/* After the field, on the page and for the Tab key: email, password, then this. */}
        <div className="flex justify-end">
          <Link to="/forgot-password" className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
            Forgot password?
          </Link>
        </div>
      </Field>
      <Button type="submit" size="lg" disabled={pending} className="mt-1 w-full">
        {pending && <Spinner />}
        {pending ? 'Signing in…' : 'Sign in'}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        New here?{' '}
        <Link to="/sign-up" className="font-medium text-foreground underline underline-offset-4">
          Create an account
        </Link>
      </p>
    </form>
  )
}
