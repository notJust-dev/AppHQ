import '@tanstack/react-start/server-only'
import { getAppSession } from './session'

/**
 * Whether this visitor may use the dashboard: they signed in with the dashboard password. This
 * is the only definition. An account (Google or GitHub) never counts, whatever its status; it
 * only reaches the Request access page.
 */
export async function hasDashboardAccess(): Promise<boolean> {
  const session = await getAppSession()
  return session.signedIn === true
}
