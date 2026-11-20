import { and, eq, inArray } from 'drizzle-orm'
import type { Connector } from '../connectors/types.js'
import type { Db, Sql } from '../db/client.js'
import { apps, syncRuns } from '../db/schema.js'
import type { Secrets } from '../lib/crypto.js'
import type { DateRange } from '../lib/dates.js'
import type { Logger } from '../lib/logger.js'

/** Arbitrary but fixed: the Postgres advisory lock that keeps two syncs from overlapping. */
const SYNC_LOCK_ID = 727_001

interface RunRecord {
  source: string
  appId?: string | null
  range?: DateRange
}

/**
 * Wraps a piece of work in a `sync_runs` row: 'running' when it starts, then 'ok' with the row
 * count or 'error' with the message. Errors are recorded and rethrown.
 */
export async function recordRun(
  db: Db,
  record: RunRecord,
  work: () => Promise<{ rowsWritten: number }>,
): Promise<{ rowsWritten: number }> {
  const [run] = await db
    .insert(syncRuns)
    .values({
      source: record.source,
      appId: record.appId ?? null,
      status: 'running',
      rangeFrom: record.range?.from,
      rangeTo: record.range?.to,
    })
    .returning({ id: syncRuns.id })
  if (!run) throw new Error('could not create sync_runs row')

  try {
    const result = await work()
    await db
      .update(syncRuns)
      .set({ status: 'ok', rowsWritten: result.rowsWritten, finishedAt: new Date() })
      .where(eq(syncRuns.id, run.id))
    return result
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await db
      .update(syncRuns)
      .set({ status: 'error', error: message.slice(0, 2000), finishedAt: new Date() })
      .where(eq(syncRuns.id, run.id))
    throw err
  }
}

export interface SyncOptions {
  connectors: Connector[]
  range: DateRange
  /** Limit to these sources; all registered connectors when omitted. */
  sources?: string[]
  /** Limit to these apps; all active apps when omitted. */
  appIds?: string[]
}

export interface SyncDeps {
  db: Db
  sql: Sql
  log: Logger
  secrets: Secrets
}

export interface SyncSummary {
  /** True when another sync held the lock and this one did nothing. */
  skipped: boolean
  ok: number
  failed: number
}

/**
 * Runs every selected connector for every selected app. One failing source or app never stops
 * the others: each run is recorded on its own. Cron entries can overlap safely because a second
 * invocation exits immediately while the first holds the advisory lock.
 */
export async function runSync(
  deps: SyncDeps,
  options: SyncOptions,
): Promise<SyncSummary> {
  const { db, sql, log, secrets } = deps
  const summary: SyncSummary = { skipped: false, ok: 0, failed: 0 }

  // Advisory locks belong to a session, so the lock and unlock must use the same connection.
  const reserved = await sql.reserve()
  try {
    const [lock] = await reserved<{ locked: boolean }[]>`
      select pg_try_advisory_lock(${SYNC_LOCK_ID}) as locked
    `
    if (!lock?.locked) {
      log.warn('Another sync is still running; skipping this one.')
      return { ...summary, skipped: true }
    }

    try {
      const selected = options.connectors.filter(
        (c) => !options.sources || options.sources.includes(c.source),
      )
      const activeApps = await db
        .select()
        .from(apps)
        .where(
          and(
            eq(apps.isActive, true),
            options.appIds ? inArray(apps.id, options.appIds) : undefined,
          ),
        )

      for (const connector of selected) {
        for (const app of activeApps) {
          if (!(await connector.isConfigured(app, db))) continue
          try {
            const { rowsWritten } = await recordRun(
              db,
              { source: connector.source, appId: app.id, range: options.range },
              () => connector.sync({ db, app, range: options.range, log, secrets }),
            )
            summary.ok++
            log.info(`${connector.source} ${app.id}: ${rowsWritten} rows`)
          } catch (err) {
            summary.failed++
            log.error(`${connector.source} ${app.id}: ${err instanceof Error ? err.message : err}`)
          }
        }
      }
    } finally {
      await reserved`select pg_advisory_unlock(${SYNC_LOCK_ID})`
    }
  } finally {
    reserved.release()
  }

  return summary
}
