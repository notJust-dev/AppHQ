import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { Check, ChevronsUpDown, LayoutGrid, Plus, Settings, Users } from 'lucide-react'
import { AppIcon } from '@/components/AppIcon'
import { Private } from '@/components/Private'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { appsQuery, type AppSummary } from '@/lib/queries'

/** The app the address limits the numbers to, if it names one that exists. */
export function useChosenApp(): AppSummary | undefined {
  const { app } = useSearch({ strict: false })
  const { data: apps = [] } = useQuery(appsQuery())
  return app ? apps.find((entry) => entry.id === app) : undefined
}

/** An app's name as the dashboard says it: the shared accounts have one of their own. */
export function AppName({ app }: { app: AppSummary }) {
  return app.kind === 'portfolio' ? <>Shared accounts</> : <Private>{app.name}</Private>
}

/**
 * Which app the dashboard shows: one, or all of them. It opens the top bar of every page that
 * follows it, as the first breadcrumb. Pages read it from `?app=` and it stays chosen from page
 * to page (see lib/range.ts), so choosing here keeps the page in view.
 */
export function AppSwitcher() {
  const { data: apps = [] } = useQuery(appsQuery())
  const chosen = useChosenApp()
  const navigate = useNavigate()
  const own = apps.filter((app) => app.kind !== 'portfolio')
  const shared = apps.find((app) => app.kind === 'portfolio')

  const choose = (appId: string | undefined) =>
    void navigate({ to: '.', search: (previous: Record<string, unknown>) => ({ ...previous, app: appId }) })

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" aria-label="Choose an app" className="max-w-full min-w-0 font-medium text-foreground">
          <ChosenIcon app={chosen} />
          <span className="truncate">{chosen ? <AppName app={chosen} /> : 'All apps'}</span>
          <ChevronsUpDown className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuGroup>
          <Choice selected={!chosen} onSelect={() => choose(undefined)}>
            <LayoutGrid />
            All apps
          </Choice>
        </DropdownMenuGroup>
        {own.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs text-muted-foreground">Your apps</DropdownMenuLabel>
            <DropdownMenuGroup className="max-h-72 overflow-y-auto">
              {own.map((app) => (
                <Choice key={app.id} selected={chosen?.id === app.id} onSelect={() => choose(app.id)}>
                  <AppIcon app={app} className="size-4 text-[9px]" />
                  <Private className="truncate">{app.name}</Private>
                </Choice>
              ))}
            </DropdownMenuGroup>
          </>
        )}
        {shared && (
          <>
            <DropdownMenuSeparator />
            <Choice selected={chosen?.id === shared.id} onSelect={() => choose(shared.id)}>
              <Users />
              Shared accounts
            </Choice>
          </>
        )}
        <DropdownMenuSeparator />
        {chosen && (
          <DropdownMenuItem asChild>
            <Link to="/apps/$appId/settings" params={{ appId: chosen.id }}>
              <Settings />
              <span className="truncate">
                <AppName app={chosen} /> settings
              </span>
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem asChild>
          <Link to="/apps/new">
            <Plus />
            Add app
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function Choice(props: { selected: boolean; onSelect: () => void; children: React.ReactNode }) {
  return (
    <DropdownMenuItem onSelect={props.onSelect} aria-current={props.selected || undefined}>
      {props.children}
      {props.selected && <Check className="ml-auto" aria-label="Chosen" />}
    </DropdownMenuItem>
  )
}

function ChosenIcon({ app }: { app: AppSummary | undefined }) {
  if (!app) return <LayoutGrid />
  if (app.kind === 'portfolio') return <Users />
  return <AppIcon app={app} className="size-4 text-[9px]" />
}
