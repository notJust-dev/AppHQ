import { useSyncExternalStore } from 'react'

/** The person's theme: the system's, or one they picked. Kept in this browser only. */
export type ThemeChoice = 'system' | 'light' | 'dark'

const KEY = 'theme'

/**
 * Runs in the page head before anything paints, so a picked theme shows without a flash of the
 * other one. Without a pick, the stylesheet follows the system.
 */
export const THEME_SCRIPT = `try{var t=localStorage.getItem('${KEY}');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`

const listeners = new Set<() => void>()

export function applyTheme(choice: ThemeChoice) {
  try {
    if (choice === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, choice)
  } catch {
    // Storage can be off (a private window); the choice then lasts for this page only.
  }
  if (choice === 'system') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = choice
  for (const listener of listeners) listener()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * The current choice, for the theme menu and anything drawn outside the stylesheet's reach,
 * such as toasts. The theme script has already put a picked theme on the page; the server
 * cannot know it, so it renders as `system` until the page hydrates.
 */
export function useThemeChoice(): ThemeChoice {
  return useSyncExternalStore(
    subscribe,
    () => (document.documentElement.dataset.theme as ThemeChoice | undefined) ?? 'system',
    () => 'system',
  )
}
