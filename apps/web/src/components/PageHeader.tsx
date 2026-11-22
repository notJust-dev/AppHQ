import { Link } from '@tanstack/react-router'
import { Fragment, type ReactNode } from 'react'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Separator } from '@/components/ui/separator'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'

export type Crumb = { label: string; to: '/' | '/apps' | '/accounts' }

const WIDTH = { wide: 'max-w-6xl', narrow: 'max-w-4xl' } as const

/**
 * The top of a page: a bar with the sidebar button and where the page sits, then its name,
 * what it is for, its actions, and its tabs.
 */
export function PageHeader(props: {
  crumbs?: Crumb[]
  title: string
  description?: ReactNode
  actions?: ReactNode
  tabs?: ReactNode
  /** For settings and forms: a narrower column, matched by the page body. */
  narrow?: boolean
}) {
  return (
    <>
      <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-2 border-b bg-background/90 px-3 backdrop-blur sm:px-4">
        <SidebarTrigger />
        <Separator orientation="vertical" className="mr-1 data-vertical:h-4 data-vertical:self-center" />
        <Breadcrumb className="min-w-0">
          <BreadcrumbList className="flex-nowrap">
            {props.crumbs?.map((crumb) => (
              <Fragment key={crumb.to}>
                <BreadcrumbItem>
                  <BreadcrumbLink asChild>
                    <Link to={crumb.to}>{crumb.label}</Link>
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
              </Fragment>
            ))}
            <BreadcrumbItem className="min-w-0">
              <BreadcrumbPage className="truncate">{props.title}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </header>

      <div className={cn('mx-auto w-full px-5 pt-6 sm:px-8 sm:pt-8', WIDTH[props.narrow ? 'narrow' : 'wide'])}>
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight break-words">{props.title}</h1>
            {props.description && <p className="mt-1.5 max-w-2xl text-muted-foreground">{props.description}</p>}
          </div>
          {props.actions && <div className="flex flex-wrap items-center gap-2">{props.actions}</div>}
        </div>
        {props.tabs && <div className="mt-5 border-b">{props.tabs}</div>}
      </div>
    </>
  )
}

/** The page's content below the header: cards on the canvas. */
export function PageBody({ children, narrow = false }: { children: ReactNode; narrow?: boolean }) {
  return (
    <div className={cn('mx-auto w-full space-y-6 px-5 py-6 sm:px-8 sm:py-8', WIDTH[narrow ? 'narrow' : 'wide'])}>
      {children}
    </div>
  )
}

/** Tab links under a page header. TanStack marks the active one with aria-current. */
export const TAB_CLASS =
  '-mb-px inline-flex h-9 items-center border-b-2 border-transparent px-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground aria-[current=page]:border-foreground aria-[current=page]:text-foreground'
