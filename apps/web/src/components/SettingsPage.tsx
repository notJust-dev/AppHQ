import { Link } from '@tanstack/react-router'
import type { ComponentProps, ReactNode } from 'react'
import { PageBody, PageHeader, TAB_CLASS, type Crumb } from '@/components/PageHeader'
import { Badge } from '@/components/ui/badge'
import { useAttention } from '@/lib/attention'

/**
 * The frame of every Settings page: the top bar from Settings down, the Settings tabs, then the
 * page's own title. Settings pages show everything at once, so they have no app switcher, and
 * they share one column width so the tabs stay put from page to page.
 */
export function SettingsPage(
  props: Omit<ComponentProps<typeof PageHeader>, 'crumbs' | 'nav' | 'narrow' | 'scoped'> & {
    /** Where the page sits under Settings, such as Apps for an app's page. */
    crumbs?: Crumb[]
    children: ReactNode
  },
) {
  const { crumbs = [], children, ...header } = props
  return (
    <>
      <PageHeader {...header} narrow crumbs={[{ label: 'Settings', to: '/settings' }, ...crumbs]} nav={<SettingsNav />} />
      <PageBody narrow>{children}</PageBody>
    </>
  )
}

/** Apps and Integrations, each with how much in it needs the person. */
function SettingsNav() {
  const { waiting, broken } = useAttention()
  return (
    <nav aria-label="Settings" className="flex gap-5">
      {/* Active on the pages under each tab too, such as an app or one integration. */}
      <Link to="/settings/apps" activeOptions={{ includeSearch: false }} className={TAB_CLASS}>
        Apps
        <Count value={waiting.length} label="waiting for a decision" />
      </Link>
      <Link to="/settings/integrations" activeOptions={{ includeSearch: false }} className={TAB_CLASS}>
        Integrations
        <Count value={broken.length} label="need attention" />
      </Link>
    </nav>
  )
}

function Count({ value, label }: { value: number; label: string }) {
  if (value === 0) return null
  return (
    <Badge variant="warning" className="ml-1.5 tabular-nums">
      {value > 99 ? '99+' : value}
      <span className="sr-only"> {label}</span>
    </Badge>
  )
}
