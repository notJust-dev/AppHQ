import { eq } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { organization } from '../db/schema.js'
import { dashboardOrganization } from '../organizations/dashboard.js'
import { scopeFor, type Scope } from '../organizations/scope.js'

/**
 * Scopes run as the code does, under row-level security; the tests' own setup and checks use
 * the test database's login, a superuser that bypasses it.
 */

/** The organization migration 0011 makes, which the dashboard password works in. */
export async function defaultScope(db: Db): Promise<Scope> {
  return scopeFor(db, await dashboardOrganization(db)())
}

/** A second organization for tests, made once per slug and reused. Slugs are invented. */
export async function testOrganization(db: Db, slug: string): Promise<Scope> {
  const [found] = await db.select({ id: organization.id }).from(organization).where(eq(organization.slug, slug))
  if (found) return scopeFor(db, found.id)
  const [made] = await db.insert(organization).values({ name: `Test ${slug}`, slug }).returning({ id: organization.id })
  return scopeFor(db, made!.id)
}
