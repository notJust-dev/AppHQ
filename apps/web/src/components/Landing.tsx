import { useServerFn } from '@tanstack/react-start'
import { CheckCircle2, Inbox, MessageSquareText, Waypoints } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { BrandMark, BrandName } from '@/components/Brand'
import { ConnectionsHub } from '@/components/ConnectionsHub'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { joinWaitlistFn } from '@/fns/waitlist'
import { WaitlistQuestions } from '@/components/WaitlistQuestions'

/** What a signed-out visitor sees at `/`, in place of the dashboard. */
export const LANDING_META = [
  { title: 'AppHQ — every app you run, one dashboard' },
  {
    name: 'description',
    content:
      'AppHQ follows each of your mobile apps from social post to store download to revenue, with every review in one inbox. Join the waitlist.',
  },
  // The root keeps the private dashboard out of search engines; this page is meant to be found.
  { name: 'robots', content: 'index, follow' },
]

/** The public landing page: what AppHQ is, and a form to join the waitlist. */
export function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center px-6 py-5">
        <p className="flex items-center gap-2.5">
          <BrandMark className="size-8" />
          <BrandName className="text-lg" />
        </p>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-6">
        <section className="grid items-center gap-12 pt-16 pb-14 sm:pt-24 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:gap-16">
          <div className="max-w-2xl">
            <Funnel />
            <h1 className="mt-6 font-brand text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
              Every app you run, from first view to revenue.
            </h1>
            <p className="mt-5 text-lg text-muted-foreground text-pretty">
              AppHQ joins your TikTok, Instagram and YouTube posts with App Store, Google Play and
              RevenueCat numbers, so you can see which post brought the downloads and what they earned.
              One dashboard for the whole portfolio.
            </p>
            <WaitlistForm />
          </div>
          <ConnectionsHub className="mx-auto max-w-[22rem] lg:max-w-none" />
        </section>

        <section className="grid gap-4 border-t py-12 sm:grid-cols-3">
          <Feature icon={<Waypoints />} title="The whole funnel">
            Views, downloads and revenue for each app, day by day, with each post marked where it went
            out.
          </Feature>
          <Feature icon={<Inbox />} title="One reviews inbox">
            New App Store and Google Play reviews for every app in one place, unread until you have
            seen them.
          </Feature>
          <Feature icon={<MessageSquareText />} title="Ask your numbers">
            Ask Claude how last week went and get an answer from your own data, not a screenshot.
          </Feature>
        </section>
      </main>

      <footer className="mx-auto w-full max-w-5xl px-6 py-8 text-sm text-faint">
        © {new Date().getFullYear()} AppHQ
      </footer>
    </div>
  )
}

/** Three stage chips in the dashboard's own funnel colours. */
function Funnel() {
  const stages = [
    { label: 'Views', color: 'var(--views)' },
    { label: 'Downloads', color: 'var(--downloads)' },
    { label: 'Revenue', color: 'var(--revenue)' },
  ]
  return (
    <p className="flex flex-wrap items-center gap-2 text-sm font-medium" aria-label="Views, downloads, revenue">
      {stages.map((stage, i) => (
        <span key={stage.label} className="flex items-center gap-2" aria-hidden="true">
          {i > 0 && <span className="text-faint">→</span>}
          <span className="flex items-center gap-1.5 rounded-full border bg-card px-3 py-1">
            <span className="size-2 rounded-full" style={{ background: stage.color }} />
            {stage.label}
          </span>
        </span>
      ))}
    </p>
  )
}

function Feature({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-5">
      <div className="text-muted-foreground [&_svg]:size-5">{icon}</div>
      <h2 className="mt-3 font-semibold">{title}</h2>
      <p className="mt-1.5 text-sm text-muted-foreground">{children}</p>
    </div>
  )
}

const PROBLEMS = {
  busy: 'Too many tries from here. Please try again in an hour.',
  failed: 'That did not go through. Check the address and try again.',
} as const

function WaitlistForm() {
  const join = useServerFn(joinWaitlistFn)
  const [email, setEmail] = useState('')
  const [website, setWebsite] = useState('')
  const [problem, setProblem] = useState<keyof typeof PROBLEMS | null>(null)
  const [pending, setPending] = useState(false)
  const [joined, setJoined] = useState(false)
  // Set once the address is saved: the follow-up questions write to that sign-up with it.
  const [answerToken, setAnswerToken] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)
  const [answered, setAnswered] = useState(false)

  if (joined) {
    return (
      <>
        <p role="status" className="mt-8 flex items-start gap-3 rounded-lg border bg-card p-4">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-[var(--downloads)]" />
          <span>
            <span className="font-medium">You are on the list.</span>{' '}
            <span className="text-muted-foreground">
              We will email {email.trim()} when AppHQ opens.
              {answered && ' Thanks for telling us about your apps.'}
            </span>
            {answerToken && !answered && !asking && (
              <button
                type="button"
                className="mt-2 block text-sm font-medium underline underline-offset-4"
                onClick={() => setAsking(true)}
              >
                Tell us about your apps
              </button>
            )}
          </span>
        </p>
        {answerToken && (
          <WaitlistQuestions
            answerToken={answerToken}
            open={asking}
            onOpenChange={setAsking}
            onSaved={() => {
              setAnswered(true)
              setAsking(false)
            }}
          />
        )}
      </>
    )
  }

  return (
    <form
      className="mt-8 max-w-md"
      onSubmit={async (event) => {
        event.preventDefault()
        setPending(true)
        try {
          const joinedNow = await join({ data: { email, website } })
          if (joinedNow.result === 'ok') {
            setJoined(true)
            setAnswerToken(joinedNow.answerToken)
            setAsking(joinedNow.answerToken !== null)
          } else {
            setProblem(joinedNow.result)
          }
        } catch {
          setProblem('failed')
        } finally {
          setPending(false)
        }
      }}
    >
      <Field data-invalid={problem !== null}>
        <FieldLabel htmlFor="email">Join the waitlist</FieldLabel>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            required
            maxLength={254}
            value={email}
            onChange={(event) => {
              setEmail(event.target.value)
              setProblem(null)
            }}
            aria-invalid={problem !== null}
            aria-describedby={problem ? 'email-problem' : undefined}
            className="h-10 sm:flex-1"
          />
          <Button type="submit" size="lg" disabled={pending} className="h-10">
            {pending && <Spinner />}
            {pending ? 'Joining…' : 'Join'}
          </Button>
        </div>
        {problem && <FieldError id="email-problem">{PROBLEMS[problem]}</FieldError>}
      </Field>
      {/* Hidden from people and screen readers; only bots fill it in. */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="absolute -left-[9999px] size-px opacity-0"
        value={website}
        onChange={(event) => setWebsite(event.target.value)}
      />
    </form>
  )
}
