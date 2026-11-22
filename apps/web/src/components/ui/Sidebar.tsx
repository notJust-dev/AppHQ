import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { AppWindow, LayoutDashboard, LogOut, Monitor, Moon, Plug, Plus, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'
import { appsQuery } from '../../lib/queries'
import { applyTheme, readTheme, type ThemeChoice } from '../../lib/theme'
import { BrandMark } from './Brand'

const NAV_ITEM =
  'flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium text-ink-soft transition-colors hover:bg-raised hover:text-ink aria-[current=page]:bg-raised aria-[current=page]:text-ink'

/** How many apps the sidebar lists before pointing to the Apps page for the rest. */
const APPS_SHOWN = 12

/**
 * The navigation: the three sections, the apps for switching between them, and the person's
 * own settings at the bottom. `onNavigate` closes the phone menu after a choice.
 */
export function Sidebar(props: { onNavigate?: () => void; onSignOut: () => void }) {
  const { data: apps = [] } = useQuery(appsQuery())
  const own = apps.filter((app) => app.kind !== 'portfolio')
  const close = props.onNavigate

  return (
    <div className="flex h-full flex-col gap-6 px-3 py-4">
      <Link
        to="/"
        onClick={close}
        className="flex items-center gap-2.5 px-2.5 text-[15px] font-semibold tracking-tight"
      >
        <BrandMark />
        AppDashboard
      </Link>

      <nav aria-label="Sections" className="space-y-0.5">
        <Link
          to="/"
          onClick={close}
          activeOptions={{ exact: true, includeSearch: false }}
          className={NAV_ITEM}
        >
          <LayoutDashboard className="size-4" aria-hidden="true" />
          Portfolio
        </Link>
        <Link to="/apps" onClick={close} activeOptions={{ exact: true }} className={NAV_ITEM}>
          <AppWindow className="size-4" aria-hidden="true" />
          Apps
        </Link>
        <Link to="/accounts" onClick={close} className={NAV_ITEM}>
          <Plug className="size-4" aria-hidden="true" />
          Accounts
        </Link>
      </nav>

      <nav aria-label="Your apps" className="min-h-0 flex-1 overflow-y-auto">
        <p className="mb-1.5 px-2.5 text-xs font-medium text-ink-faint">Your apps</p>
        <ul className="space-y-0.5">
          {own.slice(0, APPS_SHOWN).map((app) => (
            <li key={app.id}>
              <Link
                to="/apps/$appId"
                params={{ appId: app.id }}
                search={{ range: '28d' }}
                onClick={close}
                activeOptions={{ includeSearch: false }}
                className={NAV_ITEM}
              >
                <span
                  className="grid size-5 shrink-0 place-items-center rounded-[5px] border border-line bg-surface text-[11px] font-semibold text-ink"
                  aria-hidden="true"
                >
                  {app.name.charAt(0)}
                </span>
                <span className="truncate">{app.name}</span>
              </Link>
            </li>
          ))}
          {own.length > APPS_SHOWN && (
            <li>
              <Link to="/apps" onClick={close} className={`${NAV_ITEM} text-ink-faint`}>
                All {own.length} apps
              </Link>
            </li>
          )}
          <li>
            <Link to="/apps/new" onClick={close} className={NAV_ITEM}>
              <Plus className="size-4" aria-hidden="true" />
              Add app
            </Link>
          </li>
        </ul>
      </nav>

      <div className="space-y-2 border-t border-line pt-4">
        <ThemeSwitch />
        <button type="button" onClick={props.onSignOut} className={`${NAV_ITEM} w-full cursor-pointer`}>
          <LogOut className="size-4" aria-hidden="true" />
          Sign out
        </button>
      </div>
    </div>
  )
}

const THEMES: { value: ThemeChoice; label: string; Icon: typeof Sun }[] = [
  { value: 'system', label: 'System', Icon: Monitor },
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
]

/** Light, dark, or whatever the system uses; remembered in this browser. */
function ThemeSwitch() {
  // The server cannot know the stored choice, so the switch reads it once mounted.
  const [choice, setChoice] = useState<ThemeChoice>('system')
  useEffect(() => setChoice(readTheme()), [])

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="mx-2.5 grid grid-cols-3 rounded-md border border-line bg-paper p-0.5"
    >
      {THEMES.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={choice === value}
          aria-label={label}
          title={label}
          onClick={() => {
            applyTheme(value)
            setChoice(value)
          }}
          className={`grid h-6 cursor-pointer place-items-center rounded-[5px] ${
            choice === value
              ? 'bg-surface text-ink shadow-[0_0_0_1px_var(--color-line-strong)]'
              : 'text-ink-faint hover:text-ink'
          }`}
        >
          <Icon className="size-3.5" aria-hidden="true" />
        </button>
      ))}
    </div>
  )
}
