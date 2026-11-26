import { sql } from 'drizzle-orm'
import type { Db } from '../db/client.js'

/**
 * The role a unit of work switches to (see scope.ts): it can't log in, bypass row-level security
 * or create roles, and it may only read and write the organization tables. Role names belong to
 * the whole Postgres server, hence the prefix.
 */
export const TENANT_ROLE = 'apphq_tenant'

/** Every table whose rows belong to an organization; each has a policy in db/schema.ts. */
export const TENANT_TABLES = [
  'apps',
  'connections',
  'assets',
  'metric_daily',
  'posts',
  'post_snapshots',
  'reviews',
  'sync_runs',
] as const

export interface Tenancy {
  /**
   * The role a unit of work switches to, or null when it runs as the login user. That user owns
   * the tables, and FORCE ROW LEVEL SECURITY holds the policies to it as well.
   */
  role: string | null
}

/** Arbitrary but fixed: the advisory lock that makes two processes set up the role in turn. */
const SETUP_LOCK_ID = 727_003

/**
 * Makes the tenant role usable where the database allows it, and says how units of work run.
 * Runs on every start, and changes nothing the second time:
 * - when the role is missing and the login user may create roles, it creates the role and lets
 *   the login user switch to it;
 * - when the login user can switch to it, it grants the role the organization tables.
 * Otherwise (a host that doesn't let the API create roles) units of work run as the login user.
 * So a role created later, or a database moved to a host that allows roles, needs no change here.
 */
export async function setUpTenancy(db: Db): Promise<Tenancy> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${SETUP_LOCK_ID})`)
    const [login] = await tx.execute<{ can_create: boolean }>(
      sql`select rolsuper or rolcreaterole as can_create from pg_roles where rolname = current_user`,
    )
    if (login?.can_create) {
      // Another database on the same server may make it at the same moment.
      await tx.execute(
        sql.raw(`
          do $$
          begin
            if not exists (select 1 from pg_roles where rolname = '${TENANT_ROLE}') then
              create role ${TENANT_ROLE} nologin nosuperuser nobypassrls nocreaterole nocreatedb noinherit;
              grant ${TENANT_ROLE} to current_user;
            end if;
          exception when duplicate_object or unique_violation then null;
          end $$`),
      )
    }

    const [usable] = await tx.execute<{ usable: boolean }>(sql`
      select case
        when exists (select 1 from pg_roles where rolname = ${TENANT_ROLE})
          then pg_has_role(current_user, ${TENANT_ROLE}, 'MEMBER')
        else false
      end as usable`)
    if (!usable?.usable) return { role: null }

    await tx.execute(sql.raw(`grant select, insert, update, delete on table ${TENANT_TABLES.join(', ')} to ${TENANT_ROLE}`))
    return { role: TENANT_ROLE }
  })
}

const known = new WeakMap<Db, Promise<Tenancy>>()

/** How units of work run on this database, worked out once per process. */
export function tenancyOf(db: Db): Promise<Tenancy> {
  let found = known.get(db)
  if (!found) {
    found = setUpTenancy(db)
    known.set(db, found)
    // A failure is not kept, so the next unit of work tries again.
    found.catch(() => known.delete(db))
  }
  return found
}

/**
 * Everything that has to hold for row-level security to protect the organization tables, as
 * problems to fix; none when it holds. Checked as the user units of work run as: it must not
 * bypass row-level security, and every organization table must have it enabled, forced, and its
 * policy in place.
 */
export async function rowLevelSecurityProblems(db: Db, tenancy?: Tenancy): Promise<string[]> {
  const { role } = tenancy ?? (await tenancyOf(db))
  return db.transaction(async (tx) => {
    if (role) await tx.execute(sql`select set_config('role', ${role}, true)`)
    const problems: string[] = []

    const [user] = await tx.execute<{
      name: string
      rolsuper: boolean
      rolbypassrls: boolean
      rolcreaterole: boolean
      member_of_others: boolean
    }>(sql`
      select r.rolname as name, r.rolsuper, r.rolbypassrls, r.rolcreaterole,
        exists (select 1 from pg_auth_members m where m.member = r.oid) as member_of_others
      from pg_roles r where r.rolname = current_user`)
    if (!user) {
      problems.push('Could not read the role units of work run as.')
    } else {
      if (user.rolsuper) problems.push(`"${user.name}" is a superuser, which bypasses row-level security.`)
      if (user.rolbypassrls) problems.push(`"${user.name}" has BYPASSRLS, which bypasses row-level security.`)
      // The tenant role must have nothing beyond what setUpTenancy grants it.
      if (role && user.rolcreaterole) problems.push(`"${user.name}" may create roles.`)
      if (role && user.member_of_others) problems.push(`"${user.name}" is a member of other roles and gets their rights.`)
    }

    const tables = await tx.execute<{ name: string; enabled: boolean; forced: boolean; policy: boolean }>(sql`
      select c.relname as name, c.relrowsecurity as enabled, c.relforcerowsecurity as forced,
        exists (select 1 from pg_policy p where p.polrelid = c.oid and p.polname = c.relname || '_organization') as policy
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relname in (${sql.join(
        TENANT_TABLES.map((table) => sql`${table}`),
        sql`, `,
      )})`)
    for (const table of TENANT_TABLES) {
      const found = tables.find((row) => row.name === table)
      if (!found) problems.push(`Table "${table}" is missing.`)
      else if (!found.enabled) problems.push(`Row-level security is off on "${table}".`)
      else if (!found.forced) problems.push(`Row-level security is not forced on "${table}", so its owner bypasses it.`)
      else if (!found.policy) problems.push(`"${table}" has no "${table}_organization" policy.`)
    }
    return problems
  })
}

/**
 * Refuses to go on unless row-level security protects the organization tables. The API calls it
 * after migrations and before it serves anything or starts a sync, so a database that doesn't
 * hold never gets a half-working dashboard: the API doesn't start, and says why.
 */
export async function assertRowLevelSecurity(db: Db): Promise<Tenancy> {
  const problems = await rowLevelSecurityProblems(db)
  if (problems.length > 0) {
    throw new Error(`Row-level security does not protect the organization tables:\n- ${problems.join('\n- ')}`)
  }
  return tenancyOf(db)
}
