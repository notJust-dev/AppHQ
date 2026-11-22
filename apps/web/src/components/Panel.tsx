import type { ReactNode } from 'react'
import { Card, CardAction, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

/**
 * A card with an optional header (title, a line of description, actions on the right) and
 * footer. The page's sections are cards; the page itself is not.
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
    <Card
      id={props.id}
      role="region"
      aria-label={typeof props.title === 'string' ? props.title : undefined}
      className={cn('min-w-0 gap-0 py-0 [--card-spacing:--spacing(5)]', props.className)}
    >
      {hasHeader && (
        <CardHeader className="border-b pt-4 [.border-b]:pb-4">
          {props.title !== undefined && (
            <CardTitle>
              <h2>{props.title}</h2>
            </CardTitle>
          )}
          {props.description && <CardDescription className="max-w-prose">{props.description}</CardDescription>}
          {props.actions && <CardAction className="flex flex-wrap items-center gap-2">{props.actions}</CardAction>}
        </CardHeader>
      )}
      <div className={props.bodyClassName ?? 'p-5'}>{props.children}</div>
      {props.footer && <CardFooter className="py-3 text-muted-foreground">{props.footer}</CardFooter>}
    </Card>
  )
}

/**
 * A settings row inside a card: what it is and why on the left, the control on the right;
 * stacked on a phone.
 */
export function SettingRow(props: {
  label: ReactNode
  description?: ReactNode
  htmlFor?: string
  children: ReactNode
}) {
  return (
    <div className="grid gap-x-8 gap-y-3 px-5 py-5 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
      <div>
        {props.htmlFor ? (
          <Label htmlFor={props.htmlFor}>{props.label}</Label>
        ) : (
          <span className="text-sm font-medium">{props.label}</span>
        )}
        {props.description && <p className="mt-1.5 text-sm text-muted-foreground">{props.description}</p>}
      </div>
      <div className="min-w-0">{props.children}</div>
    </div>
  )
}
