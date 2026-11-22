import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Text that could tell someone which app or account this is: a name, handle, website, bundle
 * id, search term, caption or review. Privacy mode blurs it (see `lib/privacy.ts`); elements
 * that cannot be wrapped, such as an input, take the `data-private` attribute instead.
 */
export function Private(props: { children: ReactNode; className?: string }) {
  return (
    <span data-private="" className={cn(props.className)}>
      {props.children}
    </span>
  )
}
