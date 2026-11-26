import { and, count, eq, ne, sql } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { apps, assets, connections, member, metricDaily, organization, posts, reviews, syncRuns, user } from '../db/schema.js'
import { autoOrganizationSlug } from './auto.js'
import { scopeFor, type Scope } from './scope.js'

/** Every table whose rows belong to an organization. */
const DATA_TABLES = [apps, connections, assets, metricDaily, posts, reviews, syncRuns] as const

export class OwnerError extends Error {}

/** Whether an organization holds any data at all, read inside it like everything else. */
export async function holdsData(scope: Scope): Promise<boolean> {
  return scope.run(async (db) => {
    for (const table of DATA_TABLES) {
      const [row] = await db.select({ n: count() }).from(table).where(eq(table.organizationId, scope.organizationId))
      if ((row?.n ?? 0) > 0) return true
    }
    return false
  })
}

/**
 * Makes the account with this address an owner of the organization, and removes the organization
 * that was made for the account on approval when it holds no data and nobody else belongs to it.
 * Running it again changes nothing. Membership grants nothing yet: the dashboard still takes the
 * dashboard password.
 */
export async function addOwner(
  db: Db,
  input: { email: string; organizationId: string },
): Promise<{ added: boolean; removedEmpty: boolean }> {
  const [account] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(sql`lower(${user.email})`, input.email.trim().toLowerCase()))
    .limit(1)
  if (!account) throw new OwnerError('No account has that address. Sign in once at /login with Google or GitHub first.')

  return db.transaction(async (tx) => {
    const [before] = await tx
      .select({ role: member.role })
      .from(member)
      .where(and(eq(member.organizationId, input.organizationId), eq(member.userId, account.id)))
    await tx
      .insert(member)
      .values({ organizationId: input.organizationId, userId: account.id, role: 'owner' })
      .onConflictDoUpdate({ target: [member.organizationId, member.userId], set: { role: 'owner' } })

    let removedEmpty = false
    const [own] = await tx
      .select({ id: organization.id })
      .from(organization)
      .where(and(eq(organization.slug, autoOrganizationSlug(account.id)), ne(organization.id, input.organizationId)))
    if (own) {
      const [others] = await tx
        .select({ n: count() })
        .from(member)
        .where(and(eq(member.organizationId, own.id), ne(member.userId, account.id)))
      // Organizations and members have no row-level security; the data check runs inside `own`.
      if ((others?.n ?? 0) === 0 && !(await holdsData(scopeFor(db, own.id)))) {
        // Its member row goes with it. An organization with data could not be deleted anyway.
        await tx.delete(organization).where(eq(organization.id, own.id))
        removedEmpty = true
      }
    }
    return { added: before?.role !== 'owner', removedEmpty }
  })
}
