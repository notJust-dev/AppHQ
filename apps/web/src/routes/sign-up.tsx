import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { AgreeLine, AuthPage, TextLink } from '@/components/AuthPage'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { getAccountFn } from '@/fns/account'
import {
  CODE_MINUTES,
  MIN_PASSWORD_LENGTH,
  NEW_CODE_AFTER_SECONDS,
  PROBLEMS,
  confirmSignUp,
  sendSignUpCode,
  type Problem,
} from '@/lib/email-auth'

/**
 * Creating an account with an email address and a password, in two steps on one page: the
 * address and the password, then the code mailed to the address. The password stays in this
 * page until the code is entered, and both go to the API together: no account exists before
 * the address is confirmed. A new account lands on the Request access page, like any other.
 */
export const Route = createFileRoute('/sign-up')({
  loader: async () => {
    const { email, account } = await getAccountFn()
    if (account) throw redirect({ to: '/request-access' })
    // Without a mail server on the API there is no signing up this way.
    if (!email) throw redirect({ to: '/login' })
    return null
  },
  head: () => ({ meta: [{ title: 'Create an account · AppHQ' }] }),
  component: SignUpPage,
})

function SignUpPage() {
  const router = useRouter()
  const [step, setStep] = useState<'details' | 'code'>('details')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [problem, setProblem] = useState<Problem | null>(null)
  const [pending, setPending] = useState(false)
  /** Seconds until another code can be asked for. */
  const [wait, setWait] = useState(0)
  const [sentAgain, setSentAgain] = useState(false)

  useEffect(() => {
    if (wait <= 0) return
    const timer = setTimeout(() => setWait((seconds) => seconds - 1), 1000)
    return () => clearTimeout(timer)
  }, [wait])

  const askForCode = async (again: boolean) => {
    setPending(true)
    setProblem(null)
    setSentAgain(false)
    const outcome = await sendSignUpCode(email.trim())
    setPending(false)
    if (!outcome.ok) return setProblem(outcome.problem)
    setCode('')
    setWait(NEW_CODE_AFTER_SECONDS)
    setSentAgain(again)
    setStep('code')
  }

  const below = (
    <>
      <p>
        Already have an account? <TextLink to="/login">Sign in</TextLink>
      </p>
      <p className="mt-3">
        <AgreeLine />
      </p>
    </>
  )

  if (step === 'details') {
    return (
      <AuthPage title="Create an account" below={below}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (password.length < MIN_PASSWORD_LENGTH) return setProblem('short')
            void askForCode(false)
          }}
        >
          <Field data-invalid={problem === 'address'}>
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
              aria-invalid={problem === 'address'}
            />
          </Field>
          <Field data-invalid={problem === 'short' || problem === 'long'}>
            <FieldLabel htmlFor="new-password">Password</FieldLabel>
            <Input
              id="new-password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={MIN_PASSWORD_LENGTH}
              value={password}
              onChange={(event) => {
                setPassword(event.target.value)
                setProblem(null)
              }}
              aria-invalid={problem === 'short' || problem === 'long'}
              aria-describedby="new-password-hint"
            />
            <FieldDescription id="new-password-hint">At least {MIN_PASSWORD_LENGTH} characters.</FieldDescription>
          </Field>
          {problem && <FieldError>{PROBLEMS[problem]}</FieldError>}
          <Button type="submit" size="lg" disabled={pending} className="mt-1 w-full">
            {pending && <Spinner />}
            {pending ? 'Sending a code…' : 'Continue'}
          </Button>
        </form>
      </AuthPage>
    )
  }

  return (
    <AuthPage title="Check your email" below={below}>
      <p className="text-muted-foreground">
        We sent an email to <span className="font-medium text-foreground">{email.trim()}</span>. Enter the 6-digit code
        from it to finish. It works for {CODE_MINUTES} minutes. If that address already has an account, the email
        says so instead.
      </p>
      <form
        className="flex flex-col gap-4"
        onSubmit={async (event) => {
          event.preventDefault()
          setPending(true)
          setProblem(null)
          setSentAgain(false)
          const outcome = await confirmSignUp(email.trim(), code, password)
          if (outcome.ok) {
            await router.invalidate()
            await router.navigate({ to: '/request-access' })
            return
          }
          setPending(false)
          setProblem(outcome.problem)
          // The password was chosen a step ago; go back there if the API turned it down.
          if (outcome.problem === 'short' || outcome.problem === 'long') setStep('details')
        }}
      >
        <Field data-invalid={problem !== null}>
          <FieldLabel htmlFor="code">Code</FieldLabel>
          <Input
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 ]*"
            maxLength={12}
            autoFocus
            required
            className="font-mono tracking-[0.3em]"
            value={code}
            onChange={(event) => {
              setCode(event.target.value.replace(/[^0-9]/g, '').slice(0, 6))
              setProblem(null)
            }}
            aria-invalid={problem !== null}
            aria-describedby={problem ? 'code-problem' : undefined}
          />
          {problem && <FieldError id="code-problem">{PROBLEMS[problem]}</FieldError>}
        </Field>
        <Button type="submit" size="lg" disabled={pending || code.length !== 6} className="w-full">
          {pending && <Spinner />}
          {pending ? 'Creating your account…' : 'Create account'}
        </Button>
      </form>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm">
        <Button variant="link" className="h-auto p-0" disabled={pending || wait > 0} onClick={() => void askForCode(true)}>
          {wait > 0 ? `Send a new code in ${wait}s` : 'Send a new code'}
        </Button>
        <Button
          variant="link"
          className="h-auto p-0 text-muted-foreground"
          disabled={pending}
          onClick={() => {
            setStep('details')
            setProblem(null)
          }}
        >
          Use a different address
        </Button>
      </div>
      {sentAgain && (
        <p role="status" className="text-sm text-muted-foreground">
          A new code is on its way. Only the newest one works.
        </p>
      )}
    </AuthPage>
  )
}
