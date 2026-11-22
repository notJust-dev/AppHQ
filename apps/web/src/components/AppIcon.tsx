import { useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * An app's icon, rounded like on a phone, or its first letter on a tile of the same size when
 * it has none (or the image fails to load). Size and letter size come from `className`, e.g.
 * `size-7 text-xs`. It is decoration: the app's name is always written beside it.
 */
export function AppIcon(props: { app: { name: string; iconUrl?: string | null }; className?: string }) {
  const [broken, setBroken] = useState(false)
  const shape = 'shrink-0 rounded-[22%]'

  if (props.app.iconUrl && !broken) {
    return (
      <img
        src={props.app.iconUrl}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setBroken(true)}
        // A hairline keeps a white icon from melting into a white page.
        className={cn(shape, 'bg-muted object-cover outline -outline-offset-1 outline-foreground/10', props.className)}
      />
    )
  }
  return (
    <span
      aria-hidden="true"
      className={cn(shape, 'grid place-items-center border bg-muted leading-none font-semibold', props.className)}
    >
      {props.app.name.charAt(0)}
    </span>
  )
}
