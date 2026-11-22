import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useLocation, useRouter } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { AppWindow, LayoutDashboard, LogOut, Megaphone, Monitor, Moon, Plug, Plus, Store, Sun, Wallet } from 'lucide-react'
import { useEffect } from 'react'
import { BrandMark } from '@/components/Brand'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar'
import { signOutFn } from '@/fns/auth'
import { appsQuery } from '@/lib/queries'
import { applyTheme, useThemeChoice, type ThemeChoice } from '@/lib/theme'

/** TanStack marks the link to the current page with aria-current; that is the active item. */
const ACTIVE =
  'aria-[current=page]:bg-sidebar-accent aria-[current=page]:font-medium aria-[current=page]:text-sidebar-accent-foreground'

/** The pages that look at one part of the funnel across apps. */
const PERFORMANCE = [
  { to: '/social', label: 'Social', Icon: Megaphone },
  { to: '/store', label: 'Store', Icon: Store },
  { to: '/monetisation', label: 'Monetisation', Icon: Wallet },
] as const

/** How many apps the sidebar lists before pointing to the Apps page for the rest. */
const APPS_SHOWN = 12

/**
 * The navigation: the three sections, the apps for switching between them, and the theme and
 * sign-out at the bottom. Collapsed, each item keeps its icon and names itself in a tooltip.
 */
export function AppSidebar() {
  const { data: apps = [] } = useQuery(appsQuery())
  const own = apps.filter((app) => app.kind !== 'portfolio')
  const { setOpenMobile } = useSidebar()
  const { pathname } = useLocation()

  // A new page closes the phone menu, whichever way the person got there.
  useEffect(() => setOpenMobile(false), [pathname, setOpenMobile])

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg" tooltip="AppDashboard">
              <Link to="/">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg border bg-card">
                  <BrandMark className="size-4" />
                </span>
                <span className="truncate text-[15px] font-semibold tracking-tight">AppDashboard</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu aria-label="Sections">
              <SidebarMenuItem>
                <SidebarMenuButton asChild tooltip="Portfolio" className={ACTIVE}>
                  <Link to="/" activeOptions={{ exact: true, includeSearch: false }}>
                    <LayoutDashboard />
                    <span>Portfolio</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild tooltip="Apps" className={ACTIVE}>
                  <Link to="/apps" activeOptions={{ exact: true }}>
                    <AppWindow />
                    <span>Apps</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild tooltip="Accounts" className={ACTIVE}>
                  <Link to="/accounts">
                    <Plug />
                    <span>Accounts</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Performance</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu aria-label="Performance">
              {PERFORMANCE.map(({ to, label, Icon }) => (
                <SidebarMenuItem key={to}>
                  <SidebarMenuButton asChild tooltip={label} className={ACTIVE}>
                    {/* The page keeps the range and app it was last opened with in the address. */}
                    <Link to={to} activeOptions={{ includeSearch: false }}>
                      <Icon />
                      <span>{label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Your apps</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu aria-label="Your apps">
              {own.slice(0, APPS_SHOWN).map((app) => (
                <SidebarMenuItem key={app.id}>
                  <SidebarMenuButton asChild tooltip={app.name} className={ACTIVE}>
                    <Link
                      to="/apps/$appId"
                      params={{ appId: app.id }}
                      search={{ range: '28d' }}
                      activeOptions={{ includeSearch: false }}
                    >
                      <span
                        className="grid size-4 shrink-0 place-items-center rounded-[4px] border bg-card text-[10px] leading-none font-semibold"
                        aria-hidden="true"
                      >
                        {app.name.charAt(0)}
                      </span>
                      <span>{app.name}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
              {own.length > APPS_SHOWN && (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild className="text-muted-foreground">
                    <Link to="/apps">All {own.length} apps</Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
              <SidebarMenuItem>
                <SidebarMenuButton asChild tooltip="Add app" className={`text-muted-foreground ${ACTIVE}`}>
                  <Link to="/apps/new">
                    <Plus />
                    <span>Add app</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <ThemeMenu />
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SignOut />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

const THEMES: { value: ThemeChoice; label: string; Icon: typeof Sun }[] = [
  { value: 'system', label: 'System', Icon: Monitor },
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
]

/** Light, dark, or whatever the system uses; remembered in this browser. */
function ThemeMenu() {
  const choice = useThemeChoice()
  const current = THEMES.find((theme) => theme.value === choice) ?? THEMES[0]!
  const { isMobile } = useSidebar()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton tooltip="Theme">
          <current.Icon />
          <span>Theme</span>
          <span className="ml-auto text-xs text-muted-foreground">{current.label}</span>
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent side={isMobile ? 'top' : 'right'} align="end" className="w-40">
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={choice} onValueChange={(value) => applyTheme(value as ThemeChoice)}>
          {THEMES.map(({ value, label, Icon }) => (
            <DropdownMenuRadioItem key={value} value={value}>
              <Icon />
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function SignOut() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const signOut = useServerFn(signOutFn)

  return (
    <SidebarMenuButton
      tooltip="Sign out"
      onClick={async () => {
        await signOut()
        queryClient.clear()
        await router.navigate({ to: '/login' })
      }}
    >
      <LogOut />
      <span>Sign out</span>
    </SidebarMenuButton>
  )
}
