import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { BrandMark, BrandName } from '@/components/Brand'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

/** The page around the account forms: the brand, one card with a title, and a line under it. */
export function AuthPage({ title, children, below }: { title: string; children: ReactNode; below?: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6 pb-24">
      <Link to="/" className="flex items-center gap-2.5 self-start">
        <BrandMark className="size-8" />
        <BrandName className="text-lg" />
      </Link>
      <Card className="mt-8 [--card-spacing:--spacing(6)]">
        <CardHeader>
          <CardTitle>
            <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">{children}</CardContent>
      </Card>
      {below && <div className="mt-6 text-center text-sm text-muted-foreground">{below}</div>}
    </main>
  )
}

const LINK = 'font-medium underline underline-offset-4 hover:text-foreground'

/** Creating an account or signing in is the consent the privacy policy relies on. */
export function AgreeLine() {
  return (
    <>
      By continuing, you agree to the{' '}
      <Link to="/terms" className={LINK}>
        Terms
      </Link>{' '}
      and{' '}
      <Link to="/privacy" className={LINK}>
        Privacy policy
      </Link>
      .
    </>
  )
}

/** A link in the text of an account page. */
export function TextLink({ to, children }: { to: '/login' | '/sign-up' | '/forgot-password'; children: ReactNode }) {
  return (
    <Link to={to} className={`${LINK} text-foreground`}>
      {children}
    </Link>
  )
}
