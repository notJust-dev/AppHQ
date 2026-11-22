import { AlertTriangle, CircleAlert } from 'lucide-react'
import type { ReactNode } from 'react'

/**
 * A state in words. Fine states stay quiet; only a problem gets colour, with an icon so it does
 * not rest on colour alone.
 */
export function Status({ tone, children }: { tone: 'ok' | 'off' | 'warn' | 'danger'; children: ReactNode }) {
  if (tone === 'warn' || tone === 'danger') {
    const Icon = tone === 'warn' ? AlertTriangle : CircleAlert
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
          tone === 'warn' ? 'bg-warn-soft text-warn' : 'bg-danger-soft text-danger'
        }`}
      >
        <Icon className="size-3.5 shrink-0" aria-hidden="true" />
        {children}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-soft">
      <span
        className={`size-1.5 rounded-full ${tone === 'ok' ? 'bg-ink-soft' : 'border border-ink-faint'}`}
        aria-hidden="true"
      />
      {children}
    </span>
  )
}
