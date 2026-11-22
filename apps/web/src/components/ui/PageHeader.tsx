import { Link } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'

export type Crumb = { label: string; to: '/' | '/apps' | '/accounts' }

/** The band at the top of a page: where it sits, its name, its actions, and its tabs. */
export function PageHeader(props: {
  crumbs?: Crumb[]
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  tabs?: ReactNode
  /** For settings and forms: a narrower column, matched by the page body. */
  narrow?: boolean
}) {
  return (
    <div className="border-b border-line bg-surface">
      <div className={`mx-auto px-5 pt-6 sm:px-8 ${props.narrow ? 'max-w-4xl' : 'max-w-6xl'} ${props.tabs ? '' : 'pb-6'}`}>
        {props.crumbs && props.crumbs.length > 0 && (
          <nav aria-label="Breadcrumb" className="mb-2">
            <ol className="flex flex-wrap items-center gap-1 text-[13px] text-ink-soft">
              {props.crumbs.map((crumb) => (
                <li key={crumb.to} className="flex items-center gap-1">
                  <Link to={crumb.to} className="hover:text-ink">
                    {crumb.label}
                  </Link>
                  <ChevronRight className="size-3.5 text-ink-faint" aria-hidden="true" />
                </li>
              ))}
            </ol>
          </nav>
        )}
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight break-words">{props.title}</h1>
            {props.description && <p className="mt-1.5 max-w-2xl text-ink-soft">{props.description}</p>}
          </div>
          {props.actions && <div className="flex flex-wrap items-center gap-2">{props.actions}</div>}
        </div>
        {props.tabs && <div className="mt-5">{props.tabs}</div>}
      </div>
    </div>
  )
}

/** The page's content below the header: panels on the canvas. */
export function PageBody({ children, narrow = false }: { children: ReactNode; narrow?: boolean }) {
  return (
    <div className={`mx-auto space-y-6 px-5 py-6 sm:px-8 sm:py-8 ${narrow ? 'max-w-4xl' : 'max-w-6xl'}`}>
      {children}
    </div>
  )
}

/** Tab links under a page header. TanStack marks the active one with aria-current. */
export const TAB_CLASS =
  '-mb-px inline-flex h-9 items-center border-b-2 border-transparent px-1 text-[13px] font-medium text-ink-soft hover:text-ink aria-[current=page]:border-ink aria-[current=page]:text-ink'
