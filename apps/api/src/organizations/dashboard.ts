import { eq } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { organization } from '../db/schema.js'

/**
 * The slug of the organization made by migration 0011, which holds every row that existed before
 * organizations did. Neutral on purpose: it says nothing about whose data it is.
 */
export const DASHBOARD_ORGANIZATION_SLUG = 'default'

/**
 * The one place that says which organization the dashboard password works in. Every request with
 * a password session reads and writes there, and nowhere else. Its id never changes, so it is
 * read once and kept.
 *
 * A missing organization is an error, never a reason to pick another: the dashboard then fails
 * closed rather than showing anyone else's data.
 */
export function dashboardOrganization(db: Db): () => Promise<string> {
  let found: Promise<string> | undefined
  return () => {
    found ??= db
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.slug, DASHBOARD_ORGANIZATION_SLUG))
      .limit(1)
      .then(([row]) => {
        if (!row) throw new Error(`The dashboard organization ("${DASHBOARD_ORGANIZATION_SLUG}") is missing. Migrations make it.`)
        return row.id
      })
    // A failed lookup is not kept, so the next request tries again.
    found.catch(() => {
      found = undefined
    })
    return found
  }
}
