import { eq } from 'drizzle-orm'
import { parseArgs } from 'node:util'
import { connectors } from './connectors/registry.js'
import { createDb } from './db/client.js'
import { runMigrations } from './db/migrate.js'
import { loadEnv } from './env.js'
import { createSecrets } from './lib/crypto.js'
import { trailingRange } from './lib/dates.js'
import { consoleLogger as log } from './lib/logger.js'
import { organization } from './db/schema.js'
import { dashboardOrganization } from './organizations/dashboard.js'
import { addOwner } from './organizations/owner.js'
import { scopeFor } from './organizations/scope.js'
import { assertRowLevelSecurity } from './organizations/tenancy.js'
import { seedDemo } from './seed/demo.js'
import { recordRun, runSync } from './sync/runner.js'

const USAGE = `Usage: node dist/cli.js <command> [options]

Commands:
  ping                 Write a heartbeat row to sync_runs. Use it to check a cron entry.
  sync                 Run the connectors over the trailing window, for every organization.
                         --source <name>   only this source (repeatable)
                         --app <id>        only this app (repeatable; needs --organization)
                         --days <n>        window length, default 7
  migrate              Apply pending database migrations.
  seed                 Replace the demo apps with generated data.
                         --days <n>        history length, default 200
                         --allow-production
  add-owner            Make an account an owner of an organization. Once approved, it opens it.
                         --email <address> the account's address (it must have signed in once)

Every command but migrate also takes --organization <slug>. Without it, ping, seed and
add-owner work in the dashboard password's organization, and sync in every organization.
`

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    source: { type: 'string', multiple: true },
    app: { type: 'string', multiple: true },
    days: { type: 'string' },
    'allow-production': { type: 'boolean', default: false },
    organization: { type: 'string' },
    email: { type: 'string' },
  },
})

function parseDays(fallback: number): number {
  if (values.days === undefined) return fallback
  const days = Number(values.days)
  if (!Number.isInteger(days) || days < 1 || days > 400) {
    throw new Error('--days must be a whole number between 1 and 400')
  }
  return days
}

const command = positionals[0]
if (!command || !['ping', 'sync', 'migrate', 'seed', 'add-owner'].includes(command)) {
  process.stderr.write(USAGE)
  process.exit(command ? 1 : 0)
}

const env = loadEnv()
const { db, sql } = createDb(env.DATABASE_URL)
let exitCode = 0

/** The organization named by --organization, or the dashboard password's one. */
async function chosenOrganization(): Promise<string> {
  if (values.organization === undefined) return dashboardOrganization(db)()
  const [row] = await db.select({ id: organization.id }).from(organization).where(eq(organization.slug, values.organization))
  if (!row) throw new Error(`There is no organization with the slug "${values.organization}"`)
  return row.id
}

try {
  // Like the server: nothing touches organization data unless row-level security protects it.
  if (command === 'ping' || command === 'sync' || command === 'seed') await assertRowLevelSecurity(db)
  switch (command) {
    case 'ping': {
      await recordRun(scopeFor(db, await chosenOrganization()), { source: 'heartbeat' }, async () => ({ rowsWritten: 0 }))
      log.info('heartbeat recorded')
      break
    }
    case 'sync': {
      if (values.app && values.organization === undefined) {
        throw new Error('--app names an app of one organization; add --organization <slug>')
      }
      const organizationIds =
        values.organization === undefined
          ? // The list of organizations has no row-level security; each sync then runs under it.
            (await db.select({ id: organization.id }).from(organization)).map((row) => row.id)
          : [await chosenOrganization()]
      const range = trailingRange(parseDays(7))
      // One organization after the other; one's failure does not stop the next.
      for (const organizationId of organizationIds) {
        const summary = await runSync(
          { db, sql, log, secrets: createSecrets(env.ENCRYPTION_KEY) },
          { organizationId, connectors, range, sources: values.source, appIds: values.app },
        )
        log.info(summary.skipped ? 'sync skipped' : `sync finished: ${summary.ok} ok, ${summary.failed} failed`)
        if (summary.failed > 0 || summary.skipped) exitCode = 1
      }
      break
    }
    case 'migrate': {
      await runMigrations({ db, sql })
      log.info('migrations applied')
      break
    }
    case 'seed': {
      if (env.NODE_ENV === 'production' && !values['allow-production']) {
        throw new Error('Refusing to seed demo data in production without --allow-production')
      }
      const written = await seedDemo(scopeFor(db, await chosenOrganization()), { days: parseDays(200) })
      log.info(`seeded ${written.apps} demo apps and ${written.metrics} metric rows`)
      break
    }
    case 'add-owner': {
      if (!values.email) throw new Error('add-owner needs --email <address>')
      const result = await addOwner(db, { email: values.email, organizationId: await chosenOrganization() })
      log.info(result.added ? 'the account is now an owner' : 'the account was already an owner')
      if (result.removedEmpty) log.info('removed the empty organization made for it on approval')
      break
    }
  }
} catch (err) {
  log.error(err instanceof Error ? err.message : String(err))
  exitCode = 1
} finally {
  await sql.end({ timeout: 5 })
}

process.exit(exitCode)
