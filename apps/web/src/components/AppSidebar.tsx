import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useLocation, useRouter } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import {
  AppWindow,
  Eye,
  EyeOff,
  LayoutDashboard,
  LogOut,
  Megaphone,
  MessageSquareText,
  Monitor,
  Moon,
  Plug,
  Plus,
  Search,
  Store,
  Sun,
  Wallet,
} from 'lucide-react'
import { useEffect } from 'react'
import { AppIcon } from '@/components/AppIcon'
import { BrandMark, BrandName } from '@/components/Brand'
import { Private } from '@/components/Private'
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
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar'
import { signOutFn } from '@/fns/auth'
import { setPrivacy, usePrivacy } from '@/lib/privacy'
import { appsQuery, unreadReviewsQuery } from '@/lib/queries'
import { applyTheme, useThemeChoice, type ThemeChoice } from '@/lib/theme'

/** TanStack marks the link to the current page with aria-current; that is the active item. */
const ACTIVE =
  'aria-[current=page]:bg-sidebar-accent aria-[current=page]:font-medium aria-[current=page]:text-sidebar-accent-foreground'

/** The pages that look at one part of the funnel across apps. */
const PERFORMANCE = [
  { to: '/social', label: 'Social', Icon: Megaphone },
  { to: '/store', label: 'Store', Icon: Store },
  { to: '/monetisation', label: 'Monetisation', Icon: Wallet },
  { to: '/seo', label: 'SEO', Icon: Search },
] as const

/** How many apps the sidebar lists before pointing to the Apps page for the rest. */
const APPS_SHOWN = 12

/**
 * The navigation: the three sections, the apps for switching between them, and the theme and
 * sign-out at the bottom. Collapsed, each item keeps its icon and names itself in a tooltip.
 */
export function AppSidebar() {
  const { data: apps = [] } = useQuery(appsQuery())
  const { data: unread } = useQuery(unreadReviewsQuery())
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
            <SidebarMenuButton asChild size="lg" tooltip="AppHQ">
              <Link to="/">
                <BrandMark className="size-8 shrink-0" />
                <BrandName className="truncate text-[16px]" />
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
                <SidebarMenuButton asChild tooltip="Reviews" className={ACTIVE}>
                  <Link to="/reviews" activeOptions={{ includeSearch: false }}>
                    <MessageSquareText />
                    <span>Reviews</span>
                  </Link>
                </SidebarMenuButton>
                {unread && unread.count > 0 && (
                  <SidebarMenuBadge aria-label={`${unread.count} unread`}>{unread.count > 99 ? '99+' : unread.count}</SidebarMenuBadge>
                )}
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
                  <SidebarMenuButton asChild tooltip={{ children: <Private>{app.name}</Private> }} className={ACTIVE}>
                    <Link
                      to="/apps/$appId"
                      params={{ appId: app.id }}
                      search={{ range: '28d' }}
                      activeOptions={{ includeSearch: false }}
                    >
                      <AppIcon app={app} className="size-4 text-[10px]" />
                      <Private className="truncate">{app.name}</Private>
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
            <PrivacyToggle />
          </SidebarMenuItem>
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

/** Blurs app and account names everywhere, for recording or sharing the screen. */
function PrivacyToggle() {
  const on = usePrivacy()
  return (
    <SidebarMenuButton
      tooltip={on ? 'Privacy mode is on: names are blurred' : 'Privacy mode: blur app and account names'}
      aria-pressed={on}
      onClick={() => setPrivacy(!on)}
    >
      {on ? <EyeOff /> : <Eye />}
      <span>Privacy mode</span>
      <span className="ml-auto text-xs text-muted-foreground">{on ? 'On' : 'Off'}</span>
    </SidebarMenuButton>
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
