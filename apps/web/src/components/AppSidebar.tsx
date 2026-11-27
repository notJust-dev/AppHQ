import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useLocation, useRouter } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import {
  Eye,
  EyeOff,
  LayoutDashboard,
  LogOut,
  Megaphone,
  MessageSquareText,
  Monitor,
  Moon,
  Search,
  Settings,
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
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  SidebarSeparator,
  useSidebar,
} from '@/components/ui/sidebar'
import { signOutFn } from '@/fns/auth'
import { useAttention } from '@/hooks/use-attention'
import { setPrivacy, usePrivacy } from '@/lib/privacy'
import { unreadReviewsQuery } from '@/lib/queries'
import { applyTheme, useThemeChoice, type ThemeChoice } from '@/lib/theme'

/** TanStack marks the link to the current page with aria-current; that is the active item. */
const ACTIVE =
  'aria-[current=page]:bg-sidebar-accent aria-[current=page]:font-medium aria-[current=page]:text-sidebar-accent-foreground'

/**
 * The pages that follow the app chosen in the top bar, roughly in the funnel's order: people
 * see you, visit the store, pay, then review. Reviews comes in its own item, for its badge.
 */
const ANALYTICS: Section[] = [
  { to: '/', label: 'Overview', Icon: LayoutDashboard },
  {
    to: '/social',
    label: 'Social',
    Icon: Megaphone,
    pages: [
      { to: '/social', label: 'Performance' },
      { to: '/social/posts', label: 'Posts' },
    ],
  },
  { to: '/seo', label: 'SEO', Icon: Search },
  { to: '/store', label: 'Store', Icon: Store },
  { to: '/monetisation', label: 'Monetisation', Icon: Wallet },
]

/**
 * A sidebar item. A section with `pages` lists them under it while one of them is open; its own
 * link opens the first.
 */
interface Section {
  to: '/' | '/social' | '/seo' | '/store' | '/monetisation'
  label: string
  Icon: typeof Search
  pages?: { to: '/social' | '/social/posts'; label: string }[]
}

/**
 * The navigation: the pages that follow the chosen app, then Settings and the theme and
 * sign-out at the bottom. The app the dashboard shows is chosen in each page's top bar.
 * Collapsed, each item keeps its icon and names itself in a tooltip.
 * `organization`: the name of the organization the dashboard works in, when the API said.
 */
export function AppSidebar({ organization }: { organization: string | null }) {
  const { data: unread } = useQuery(unreadReviewsQuery())
  const attention = useAttention()
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
              {ANALYTICS.map(({ to, label, Icon, pages }) => {
                const open = pages !== undefined && (pathname === to || pathname.startsWith(`${to}/`))
                return (
                  <SidebarMenuItem key={to}>
                    {/* With its pages open, the page is marked below, not the section. */}
                    <SidebarMenuButton asChild tooltip={label} className={pages ? undefined : ACTIVE}>
                      {/* The app and range in the address come along; see lib/range.ts. */}
                      <Link to={to} activeOptions={{ exact: to === '/', includeSearch: false }}>
                        <Icon />
                        <span>{label}</span>
                      </Link>
                    </SidebarMenuButton>
                    {open && (
                      <SidebarMenuSub aria-label={label}>
                        {pages.map((page) => (
                          <SidebarMenuSubItem key={page.to}>
                            <SidebarMenuSubButton asChild className={ACTIVE} data-active={undefined}>
                              <Link to={page.to} activeOptions={{ exact: true, includeSearch: false }}>
                                <span>{page.label}</span>
                              </Link>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        ))}
                      </SidebarMenuSub>
                    )}
                  </SidebarMenuItem>
                )
              })}
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
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Settings, at the bottom: what feeds the dashboard, visited less than the pages above.
            The line is as wide as the items, inset the same on both sides; w-full would push it
            off. */}
        <SidebarSeparator className="mx-2 mt-auto opacity-50 data-horizontal:w-auto" />
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu aria-label="Setup">
              <SidebarMenuItem>
                <SidebarMenuButton asChild tooltip="Settings" className={ACTIVE}>
                  {/* Active on every page under it: Apps, Integrations and what is in them. */}
                  <Link to="/settings" activeOptions={{ includeSearch: false }}>
                    <Settings />
                    <span>Settings</span>
                  </Link>
                </SidebarMenuButton>
                {/* Sources waiting for a decision, and integrations that stopped working. */}
                {attention.total > 0 && (
                  <SidebarMenuBadge
                    aria-label={`${attention.total} ${attention.total === 1 ? 'needs' : 'need'} attention`}
                    className="bg-warning-soft text-warning peer-hover/menu-button:text-warning peer-data-active/menu-button:text-warning"
                  >
                    {attention.total > 99 ? '99+' : attention.total}
                  </SidebarMenuBadge>
                )}
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
