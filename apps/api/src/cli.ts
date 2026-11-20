import { parseArgs } from 'node:util'
import { connectors } from './connectors/registry.js'
import { createDb } from './db/client.js'
import { runMigrations } from './db/migrate.js'
import { loadEnv } from './env.js'
import { createSecrets } from './lib/crypto.js'
import { trailingRange } from './lib/dates.js'
import { consoleLogger as log } from './lib/logger.js'
import { seedDemo } from './seed/demo.js'
import { recordRun, runSync } from './sync/runner.js'

const USAGE = `Usage: node dist/cli.js <command> [options]

Commands:
  ping                 Write a heartbeat row to sync_runs. Use it to check a cron entry.
  sync                 Run the connectors over the trailing window.
                         --source <name>   only this source (repeatable)
                         --app <id>        only this app (repeatable)
                         --days <n>        window length, default 7
  migrate              Apply pending database migrations.
  seed                 Replace the demo apps with generated data.
                         --days <n>        history length, default 200
                         --allow-production
`

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    source: { type: 'string', multiple: true },
    app: { type: 'string', multiple: true },
    days: { type: 'string' },
    'allow-production': { type: 'boolean', default: false },
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
if (!command || !['ping', 'sync', 'migrate', 'seed'].includes(command)) {
  process.stderr.write(USAGE)
  process.exit(command ? 1 : 0)
}

const env = loadEnv()
const { db, sql } = createDb(env.DATABASE_URL)
let exitCode = 0

try {
  switch (command) {
    case 'ping': {
      await recordRun(db, { source: 'heartbeat' }, async () => ({ rowsWritten: 0 }))
      log.info('heartbeat recorded')
      break
    }
    case 'sync': {
      const summary = await runSync(
        { db, sql, log, secrets: createSecrets(env.ENCRYPTION_KEY) },
        {
          connectors,
          range: trailingRange(parseDays(7)),
          sources: values.source,
          appIds: values.app,
        },
      )
      log.info(
        summary.skipped
          ? 'sync skipped'
          : `sync finished: ${summary.ok} ok, ${summary.failed} failed`,
      )
      if (summary.failed > 0) exitCode = 1
      break
    }
    case 'migrate': {
      await runMigrations(db)
      log.info('migrations applied')
      break
    }
    case 'seed': {
      if (env.NODE_ENV === 'production' && !values['allow-production']) {
        throw new Error('Refusing to seed demo data in production without --allow-production')
      }
      const written = await seedDemo(db, { days: parseDays(200) })
      log.info(`seeded ${written.apps} demo apps and ${written.metrics} metric rows`)
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
