import { createFileRoute, redirect } from '@tanstack/react-router'
import { useState } from 'react'
import { AuthPage, TextLink } from '@/components/AuthPage'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { getAccountFn } from '@/fns/account'
import { PROBLEMS, RESET_MINUTES, requestPasswordReset, type Problem } from '@/lib/email-auth'

/**
 * Asking for a link to choose a new password. The page says the same thing whether or not the
 * address has an account, so it tells nobody who has one; what the address gets by mail differs.
 */
export const Route = createFileRoute('/forgot-password')({
  loader: async () => {
    const { email } = await getAccountFn()
    if (!email) throw redirect({ to: '/login' })
    return null
  },
  head: () => ({ meta: [{ title: 'Reset your password · AppHQ' }] }),
  component: ForgotPasswordPage,
})

function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [problem, setProblem] = useState<Problem | null>(null)
  const [pending, setPending] = useState(false)

  const below = (
    <p>
      Remembered it? <TextLink to="/login">Sign in</TextLink>
    </p>
  )

  if (sentTo) {
    return (
      <AuthPage title="Check your email" below={below}>
        <p role="status" className="text-muted-foreground">
          If <span className="font-medium text-foreground">{sentTo}</span> has an account, an email is on its way with
          a link to choose a new password. The link works once, for {RESET_MINUTES} minutes.
        </p>
        <p className="text-sm text-muted-foreground">
          Nothing after a few minutes? Check the spelling and your spam folder, then{' '}
          <Button variant="link" className="h-auto p-0" onClick={() => setSentTo(null)}>
            try again
          </Button>
          .
        </p>
      </AuthPage>
    )
  }

  return (
    <AuthPage title="Reset your password" below={below}>
      <p className="text-muted-foreground">Enter the email address of your account and we will send you a link to choose a new password.</p>
      <form
        className="flex flex-col gap-4"
        onSubmit={async (event) => {
          event.preventDefault()
          setPending(true)
          setProblem(null)
          const outcome = await requestPasswordReset(email.trim())
          setPending(false)
          if (outcome.ok) setSentTo(email.trim())
          else setProblem(outcome.problem)
        }}
      >
        <Field data-invalid={problem !== null}>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            autoFocus
            required
            value={email}
            onChange={(event) => {
              setEmail(event.target.value)
              setProblem(null)
            }}
            aria-invalid={problem !== null}
            aria-describedby={problem ? 'forgot-problem' : undefined}
          />
          {problem && <FieldError id="forgot-problem">{PROBLEMS[problem]}</FieldError>}
        </Field>
        <Button type="submit" size="lg" disabled={pending} className="w-full">
          {pending && <Spinner />}
          {pending ? 'Sending…' : 'Send the link'}
        </Button>
      </form>
    </AuthPage>
  )
}
