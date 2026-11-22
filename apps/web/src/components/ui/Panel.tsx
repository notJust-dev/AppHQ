import type { ReactNode } from 'react'

/**
 * A bordered panel with an optional header row (title, a line of description, actions on the
 * right) and footer. The page's sections are panels; the page itself is not.
 */
export function Panel(props: {
  title?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  footer?: ReactNode
  /** The body's padding; tables and lists that run edge to edge pass ''. */
  bodyClassName?: string
  className?: string
  id?: string
  children: ReactNode
}) {
  const hasHeader = props.title !== undefined || props.actions !== undefined
  return (
    <section
      id={props.id}
      className={`min-w-0 rounded-lg border border-line bg-surface ${props.className ?? ''}`}
      aria-label={typeof props.title === 'string' ? props.title : undefined}
    >
      {hasHeader && (
        <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line px-5 py-3.5">
          <div className="min-w-0">
            {props.title !== undefined && (
              <h2 className="text-[15px] font-semibold tracking-tight">{props.title}</h2>
            )}
            {props.description && (
              <p className="mt-0.5 max-w-prose text-[13px] text-ink-soft">{props.description}</p>
            )}
          </div>
          {props.actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{props.actions}</div>}
        </header>
      )}
      <div className={props.bodyClassName ?? 'p-5'}>{props.children}</div>
      {props.footer && (
        <footer className="rounded-b-lg border-t border-line bg-paper/60 px-5 py-3 text-[13px] text-ink-soft">
          {props.footer}
        </footer>
      )}
    </section>
  )
}

/**
 * A settings row inside a panel: what it is and why on the left, the control on the right;
 * stacked on a phone.
 */
export function SettingRow(props: {
  label: ReactNode
  description?: ReactNode
  htmlFor?: string
  children: ReactNode
}) {
  const Label = props.htmlFor ? 'label' : 'div'
  return (
    <div className="grid gap-x-8 gap-y-3 px-5 py-5 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
      <div>
        <Label
          {...(props.htmlFor ? { htmlFor: props.htmlFor } : {})}
          className="block text-[13px] font-medium"
        >
          {props.label}
        </Label>
        {props.description && <p className="mt-1 text-[13px] text-ink-soft">{props.description}</p>}
      </div>
      <div className="min-w-0">{props.children}</div>
    </div>
  )
}
