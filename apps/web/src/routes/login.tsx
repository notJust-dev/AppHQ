import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { getSessionFn, signInFn } from '../fns/auth'

export const Route = createFileRoute('/login')({
  beforeLoad: async () => {
    const { signedIn } = await getSessionFn()
    if (signedIn) throw redirect({ to: '/' })
  },
  component: LoginPage,
})

const MESSAGES = {
  wrong: 'That password is not correct.',
  locked: 'Too many attempts. Try again in 10 minutes.',
} as const

function LoginPage() {
  const router = useRouter()
  const signIn = useServerFn(signInFn)
  const [password, setPassword] = useState('')
  const [problem, setProblem] = useState<keyof typeof MESSAGES | null>(null)
  const [pending, setPending] = useState(false)

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6 pb-24">
      <p className="font-display text-lg font-semibold tracking-tight">AppDashboard</p>
      <h1 className="mt-6 font-display text-3xl font-semibold tracking-tight">Sign in</h1>
      <form
        className="mt-8"
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
        <label htmlFor="password" className="text-sm font-medium">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          autoFocus
          required
          value={password}
          onChange={(event) => {
            setPassword(event.target.value)
            setProblem(null)
          }}
          aria-invalid={problem !== null}
          aria-describedby={problem ? 'password-problem' : undefined}
          className="mt-2 block w-full rounded-md border border-line bg-surface px-3 py-2"
        />
        {problem && (
          <p id="password-problem" role="alert" className="mt-2 text-sm">
            {MESSAGES[problem]}
          </p>
        )}
        <button
          type="submit"
          disabled={pending}
          className="mt-6 w-full cursor-pointer rounded-md bg-ink px-4 py-2.5 font-medium text-surface disabled:cursor-default disabled:opacity-60"
        >
          {pending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  )
}
