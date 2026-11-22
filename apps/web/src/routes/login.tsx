import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { BrandMark } from '@/components/Brand'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { getSessionFn, signInFn } from '@/fns/auth'

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
      <p className="flex items-center gap-2.5 text-[15px] font-semibold tracking-tight">
        <BrandMark />
        AppDashboard
      </p>
      <Card className="mt-8 [--card-spacing:--spacing(6)]">
        <CardHeader>
          <CardTitle>
            <h1 className="text-xl font-semibold tracking-tight">Sign in</h1>
          </CardTitle>
        </CardHeader>
        <CardContent>
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
              <FieldLabel htmlFor="password">Password</FieldLabel>
              <Input
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
              />
              {problem && <FieldError id="password-problem">{MESSAGES[problem]}</FieldError>}
            </Field>
            <Button type="submit" size="lg" disabled={pending} className="mt-5 w-full">
              {pending && <Spinner />}
              {pending ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
