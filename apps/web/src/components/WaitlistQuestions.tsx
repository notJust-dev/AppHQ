import { useServerFn } from '@tanstack/react-start'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { answerWaitlistFn, type WaitlistAnswers } from '@/fns/waitlist'

type Choice<K extends keyof WaitlistAnswers> = NonNullable<WaitlistAnswers[K]> extends (infer T)[] ? T : NonNullable<WaitlistAnswers[K]>

/** Labels for the answer keys the API accepts; the types keep the two lists in step. */
const APP_COUNT: [Choice<'appCount'>, string][] = [
  ['none_yet', 'None yet'],
  ['1', '1'],
  ['2_3', '2–3'],
  ['4_10', '4–10'],
  ['11_plus', '11+'],
]
const MRR: [Choice<'mrr'>, string][] = [
  ['0', '$0'],
  ['under_1k', 'Under $1k'],
  ['1k_10k', '$1k–10k'],
  ['10k_50k', '$10k–50k'],
  ['50k_plus', '$50k+'],
  ['rather_not_say', 'Rather not say'],
]
const MONETISATION: [Choice<'monetisation'>, string][] = [
  ['revenuecat', 'RevenueCat'],
  ['superwall', 'Superwall'],
  ['adapty', 'Adapty'],
  ['qonversion', 'Qonversion'],
  ['stripe', 'Stripe'],
  ['in_house', 'Own StoreKit / Play Billing'],
  ['other', 'Other'],
]
const ANALYTICS: [Choice<'analytics'>, string][] = [
  ['firebase', 'Firebase'],
  ['mixpanel', 'Mixpanel'],
  ['amplitude', 'Amplitude'],
  ['posthog', 'PostHog'],
  ['appsflyer', 'AppsFlyer'],
  ['adjust', 'Adjust'],
  ['other', 'Other'],
]
const STORES: [Choice<'stores'>, string][] = [
  ['app_store', 'App Store'],
  ['google_play', 'Google Play'],
]
const PLATFORMS: [Choice<'platforms'>, string][] = [
  ['tiktok', 'TikTok'],
  ['instagram', 'Instagram'],
  ['threads', 'Threads'],
  ['youtube', 'YouTube'],
  ['x', 'X'],
  ['facebook', 'Facebook'],
  ['reddit', 'Reddit'],
  ['linkedin', 'LinkedIn'],
  ['paid_ads', 'Paid ads'],
  ['ugc', 'UGC'],
  ['aso', 'ASO'],
  ['seo', 'SEO'],
  ['other', 'Other'],
]
const TEAM_SIZE: [Choice<'teamSize'>, string][] = [
  ['solo', 'Just me'],
  ['2_5', '2–5 people'],
  ['6_plus', '6+'],
]
const WOULD_PAY: [Choice<'wouldPay'>, string][] = [
  ['10_30', '$10–30'],
  ['30_100', '$30–100'],
  ['100_plus', '$100+'],
  ['not_sure', 'Not sure yet'],
]

type Key = keyof WaitlistAnswers

/** One question per step, in the order they are asked. */
type Step =
  | { key: Key; kind: 'single'; question: string; options: [string, string][] }
  | { key: Key; kind: 'multi'; question: string; options: [string, string][] }
  | { key: Key; kind: 'text'; question: string; placeholder?: string; maxLength: number }

const STEPS: Step[] = [
  { key: 'appCount', kind: 'single', question: 'How many apps do you have live?', options: APP_COUNT },
  { key: 'mrr', kind: 'single', question: 'What is their combined monthly recurring revenue?', options: MRR },
  { key: 'monetisation', kind: 'multi', question: 'Which tools handle your subscriptions and payments?', options: MONETISATION },
  { key: 'analytics', kind: 'multi', question: 'Which analytics or attribution tools do you use?', options: ANALYTICS },
  { key: 'stores', kind: 'multi', question: 'Which stores are they in?', options: STORES },
  { key: 'platforms', kind: 'multi', question: 'Where do you market them?', options: PLATFORMS },
  { key: 'teamSize', kind: 'single', question: 'Who works on them?', options: TEAM_SIZE },
  { key: 'wouldPay', kind: 'single', question: 'What would a tool like this be worth to you a month?', options: WOULD_PAY },
  {
    key: 'currentTools',
    kind: 'text',
    question: 'How do you follow your numbers today?',
    placeholder: 'Spreadsheets, App Store Connect, RevenueCat…',
    maxLength: 500,
  },
  { key: 'note', kind: 'text', question: 'Anything you wish a dashboard like this did?', maxLength: 1000 },
]

/** How long typing pauses before a text answer is saved. */
const TEXT_SAVE_DELAY_MS = 700
/** A beat to see the choice land before a single-choice question moves on. */
const ADVANCE_DELAY_MS = 250

type SaveState = 'idle' | 'saving' | 'saved' | 'failed'

/**
 * The optional questions shown after someone joins the waitlist, to size the demand: one per
 * step. Each answer is saved as soon as it is given, so whatever someone answers is kept even if
 * they close the popup halfway. Closing and reopening picks up at the same step.
 */
export function WaitlistQuestions({
  answerToken,
  open,
  onOpenChange,
  onSaved,
}: {
  answerToken: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const answer = useServerFn(answerWaitlistFn)
  const [answers, setAnswers] = useState<WaitlistAnswers>({})
  const [index, setIndex] = useState(0)
  const [saveState, setSaveState] = useState<SaveState>('idle')

  // Saves go out one after another, so a quick change never lands before an older one.
  const queue = useRef<Promise<void>>(Promise.resolve())
  const waiting = useRef(0)
  // Text typed but not saved yet, and the timer that will save it.
  const unsavedText = useRef<Partial<WaitlistAnswers>>({})
  const textTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => {
    clearTimeout(textTimer.current)
    clearTimeout(advanceTimer.current)
  }, [])

  const save = (change: WaitlistAnswers, completed?: boolean): Promise<void> => {
    waiting.current += 1
    setSaveState('saving')
    queue.current = queue.current.then(async () => {
      try {
        await answer({ data: { answerToken, answers: change, completed } })
        waiting.current -= 1
        if (waiting.current === 0) setSaveState('saved')
      } catch {
        waiting.current -= 1
        setSaveState('failed')
      }
    })
    return queue.current
  }

  const flushText = () => {
    clearTimeout(textTimer.current)
    const change = unsavedText.current
    unsavedText.current = {}
    return Object.keys(change).length > 0 ? save(change) : queue.current
  }

  const step = STEPS[index]!
  const last = index === STEPS.length - 1
  const value = answers[step.key]
  const answered = Array.isArray(value) ? value.length > 0 : value != null && value !== ''

  const go = (to: number) => {
    clearTimeout(advanceTimer.current)
    void flushText()
    setIndex(Math.max(0, Math.min(STEPS.length - 1, to)))
  }

  const finish = async () => {
    clearTimeout(advanceTimer.current)
    await flushText()
    await save({}, true)
    onSaved()
  }

  const choose = (key: Key, next: WaitlistAnswers[Key], advance: boolean) => {
    setAnswers((current) => ({ ...current, [key]: next }))
    void save({ [key]: next ?? null })
    if (advance && !last) {
      clearTimeout(advanceTimer.current)
      advanceTimer.current = setTimeout(() => setIndex((i) => Math.min(i + 1, STEPS.length - 1)), ADVANCE_DELAY_MS)
    }
  }

  const type = (key: Key, next: string) => {
    setAnswers((current) => ({ ...current, [key]: next }))
    unsavedText.current = { ...unsavedText.current, [key]: next }
    clearTimeout(textTimer.current)
    textTimer.current = setTimeout(() => void flushText(), TEXT_SAVE_DELAY_MS)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          clearTimeout(advanceTimer.current)
          void flushText()
        }
        onOpenChange(next)
      }}
    >
      {/* No description: the title and the question say it all. */}
      <DialogContent className="sm:max-w-lg" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Tell us about your apps</DialogTitle>
        </DialogHeader>

        <div
          className="h-1 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-label="Questions answered"
          aria-valuemin={1}
          aria-valuemax={STEPS.length}
          aria-valuenow={index + 1}
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-300"
            style={{ width: `${((index + 1) / STEPS.length) * 100}%` }}
          />
        </div>

        <fieldset key={step.key} className="grid min-h-44 content-start gap-3">
          <legend className="mb-3 text-lg font-semibold tracking-tight text-balance">{step.question}</legend>
          {step.kind === 'multi' && <p className="-mt-1 text-sm text-muted-foreground">Pick all that apply.</p>}

          {step.kind === 'single' && (
            <div className="flex flex-wrap gap-2">
              {step.options.map(([key, label]) => (
                <label key={key} className={CHIP}>
                  <input
                    type="radio"
                    name={step.key}
                    value={key}
                    className="sr-only"
                    checked={value === key}
                    onChange={() => choose(step.key, key as never, true)}
                    // A second click on the chosen answer clears it, since every question is optional.
                    onClick={() => value === key && choose(step.key, undefined, false)}
                  />
                  {label}
                </label>
              ))}
            </div>
          )}

          {step.kind === 'multi' && (
            <div className="flex flex-wrap gap-2">
              {step.options.map(([key, label]) => {
                const list = (Array.isArray(value) ? value : []) as string[]
                return (
                  <label key={key} className={CHIP}>
                    <input
                      type="checkbox"
                      name={step.key}
                      value={key}
                      className="sr-only"
                      checked={list.includes(key)}
                      onChange={(event) =>
                        choose(
                          step.key,
                          (event.target.checked ? [...list, key] : list.filter((v) => v !== key)) as never,
                          false,
                        )
                      }
                    />
                    {label}
                  </label>
                )
              })}
            </div>
          )}

          {step.kind === 'text' && (
            <Textarea
              aria-label={step.question}
              rows={3}
              autoFocus
              maxLength={step.maxLength}
              placeholder={step.placeholder}
              value={typeof value === 'string' ? value : ''}
              onChange={(event) => type(step.key, event.target.value)}
              onBlur={() => void flushText()}
            />
          )}
        </fieldset>

        <DialogFooter className="items-center sm:justify-between">
          <p aria-live="polite" className="text-xs text-muted-foreground">
            {saveState === 'failed' && <span className="text-destructive">Not saved. Try that answer again.</span>}
          </p>
          <div className="flex gap-2">
            {index > 0 && (
              <Button variant="ghost" onClick={() => go(index - 1)}>
                Back
              </Button>
            )}
            {last ? (
              <Button onClick={() => void finish()}>Finish</Button>
            ) : (
              <Button variant={answered ? 'default' : 'outline'} onClick={() => go(index + 1)}>
                {answered ? 'Next' : 'Skip'}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const CHIP =
  'cursor-pointer rounded-full border bg-card px-3 py-1.5 text-sm transition-colors select-none hover:bg-accent has-checked:border-primary has-checked:bg-primary has-checked:text-primary-foreground has-checked:hover:bg-primary/90 has-focus-visible:ring-2 has-focus-visible:ring-ring'
