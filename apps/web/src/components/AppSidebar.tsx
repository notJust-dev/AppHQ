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
  Search,
  Store,
  Sun,
  Wallet,
} from 'lucide-react'
import { useEffect } from 'react'
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
import { unreadReviewsQuery } from '@/lib/queries'
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

/**
 * The navigation: the sections, and the theme and sign-out at the bottom. The app the
 * dashboard shows is chosen in each page's top bar. Collapsed, each item keeps its icon and
 * names itself in a tooltip.
 * `organization`: the name of the organization the dashboard works in, when the API said.
 */
export function AppSidebar({ organization }: { organization: string | null }) {
  const { data: unread } = useQuery(unreadReviewsQuery())
  const { setOpenMobile } = useSidebar()
  const { pathname } = useLocation()

  // A new page closes the phone menu, whichever way the person got there.
  useEffect(() => setOpenMobile(false), [pathname, setOpenMobile])

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg" tooltip={organization ? `AppHQ · ${organization}` : 'AppHQ'}>
              <Link to="/">
                {/* The button sizes every svg inside it to size-4; the mark is the whole tile. */}
                <BrandMark className="size-8! shrink-0" />
                <span className="flex min-w-0 flex-col leading-tight">
                  <BrandName className="truncate text-[16px]" />
                  {organization && (
                    <Private className="truncate text-xs font-normal text-muted-foreground">{organization}</Private>
                  )}
                </span>
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
                <SidebarMenuButton asChild tooltip="Overview" className={ACTIVE}>
                  <Link to="/" activeOptions={{ exact: true, includeSearch: false }}>
                    <LayoutDashboard />
                    <span>Overview</span>
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
                    {/* The app and range in the address come along; see lib/range.ts. */}
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
        // Both ways in: the password session here, and the account session, if any. Signing out
        // of an account that isn't signed in changes nothing.
        await signOut()
        await fetch('/api/auth/sign-out', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).catch(
          () => undefined,
        )
        queryClient.clear()
        await router.navigate({ to: '/login' })
      }}
    >
      <LogOut />
      <span>Sign out</span>
    </SidebarMenuButton>
  )
}
