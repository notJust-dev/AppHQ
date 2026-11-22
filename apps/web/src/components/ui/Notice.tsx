import type { ReactNode } from 'react'

/** A line saying how something went. A problem gets the danger tone and is announced at once. */
export function Notice({ ok = true, children }: { ok?: boolean; children: ReactNode }) {
  return (
    <p
      role={ok ? 'status' : 'alert'}
      className={`rounded-lg border px-4 py-3 text-[13px] ${
        ok ? 'border-line bg-surface' : 'border-transparent bg-danger-soft text-danger'
      }`}
    >
      {children}
    </p>
  )
}
