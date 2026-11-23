import { BRAND_LOGOS } from '@/lib/brand-logos'
import { sourceLabel } from '@/lib/sources'
import { cn } from '@/lib/utils'

/**
 * A source's logo, such as TikTok's or the App Store's, in the text colour and sized to the text
 * around it. On its own it stands for the name: screen readers say the name, and hovering shows
 * it. Beside the written name, pass `decorative` so the name is not said twice. A source with no
 * logo is written out instead.
 */
export function SourceLogo(props: { source: string; className?: string; decorative?: boolean }) {
  const logo = BRAND_LOGOS[props.source]
  const label = sourceLabel(props.source) === props.source && logo ? logo.title : sourceLabel(props.source)
  if (!logo) return props.decorative ? null : <span className={props.className}>{label}</span>
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={cn('inline-block size-[1.1em] shrink-0 align-[-0.2em]', props.className)}
      {...(props.decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label })}
    >
      {!props.decorative && <title>{label}</title>}
      <path d={logo.path} />
    </svg>
  )
}

/**
 * An account source's logos, beside its name: Facebook and Instagram connect together, so that
 * source shows both.
 */
export function FamilyLogo(props: { family: string; className?: string }) {
  if (props.family === 'meta') {
    return (
      <span className="inline-flex items-center gap-1" aria-hidden="true">
        <SourceLogo source="facebook" decorative className={props.className} />
        <SourceLogo source="instagram" decorative className={props.className} />
      </span>
    )
  }
  return <SourceLogo source={props.family} decorative className={props.className} />
}
