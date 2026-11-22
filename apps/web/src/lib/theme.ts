/** The person's theme: the system's, or one they picked. Kept in this browser only. */
export type ThemeChoice = 'system' | 'light' | 'dark'

const KEY = 'theme'

/**
 * Runs in the page head before anything paints, so a picked theme shows without a flash of the
 * other one. Without a pick, the stylesheet follows the system.
 */
export const THEME_SCRIPT = `try{var t=localStorage.getItem('${KEY}');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`

export function readTheme(): ThemeChoice {
  try {
    const stored = localStorage.getItem(KEY)
    return stored === 'light' || stored === 'dark' ? stored : 'system'
  } catch {
    return 'system'
  }
}

export function applyTheme(choice: ThemeChoice) {
  try {
    if (choice === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, choice)
  } catch {
    // Storage can be off (a private window); the choice then lasts for this page only.
  }
  if (choice === 'system') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = choice
}
