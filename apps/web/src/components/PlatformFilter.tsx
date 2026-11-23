import { useMemo, useState } from 'react'
import { sourceLabel } from '@/lib/sources'

/** Social platforms in the order the filter lists them, so each keeps its place. */
const ORDER = ['tiktok', 'instagram', 'facebook', 'youtube']

const rank = (platform: string) => {
  const index = ORDER.indexOf(platform)
  return index === -1 ? ORDER.length : index
}

/**
 * Which of `items` to show for the chosen platform. The choices are the platforms the items
 * have, so none of them ever leaves the table empty; a choice the items no longer have, as after
 * changing the range, falls back to all.
 */
export function usePlatformFilter<T extends { platform: string }>(items: T[]) {
  const [chosen, setChosen] = useState<string | null>(null)
  const platforms = useMemo(
    () =>
      [...new Set(items.map((item) => item.platform))].sort(
        (a, b) => rank(a) - rank(b) || sourceLabel(a).localeCompare(sourceLabel(b)),
      ),
    [items],
  )
  const platform = chosen !== null && platforms.includes(chosen) ? chosen : null
  const shown = useMemo(
    () => (platform === null ? items : items.filter((item) => item.platform === platform)),
    [items, platform],
  )
  return { platform, platforms, setPlatform: setChosen, shown }
}

/**
 * Narrows a table to one platform. Drawn like the range switch, as a row of pressed and
 * unpressed buttons; nothing to choose between with one platform, so then it is not drawn.
 */
export function PlatformFilter(props: {
  platforms: string[]
  value: string | null
  onChange: (platform: string | null) => void
}) {
  if (props.platforms.length < 2) return null
  return (
    <div
      role="group"
      aria-label="Platform"
      className="inline-flex h-8 items-center rounded-lg bg-muted p-[3px] text-muted-foreground"
    >
      {[null, ...props.platforms].map((platform) => {
        const active = platform === props.value
        return (
          <button
            key={platform ?? 'all'}
            type="button"
            aria-pressed={active}
            onClick={() => props.onChange(platform)}
            className="inline-flex h-full cursor-pointer items-center rounded-md px-2.5 text-sm font-medium whitespace-nowrap transition-colors hover:text-foreground aria-pressed:bg-card aria-pressed:text-foreground aria-pressed:shadow-sm dark:aria-pressed:bg-input"
          >
            {platform === null ? 'All' : sourceLabel(platform)}
          </button>
        )
      })}
    </div>
  )
}
