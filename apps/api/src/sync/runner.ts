import { and, eq, inArray } from 'drizzle-orm'
import type { Connector } from '../connectors/types.js'
import type { Db, Sql } from '../db/client.js'
import { apps, syncRuns } from '../db/schema.js'
import type { Secrets } from '../lib/crypto.js'
import type { DateRange } from '../lib/dates.js'
import { reportError } from '../lib/errors.js'
import type { Logger } from '../lib/logger.js'
import { scopeFor, type Scope } from '../organizations/scope.js'

/**
 * Arbitrary but fixed: with the organization, the Postgres advisory lock that keeps two syncs of
 * one organization from overlapping. Organizations never wait for each other.
 */
const SYNC_LOCK_ID = 727_001

interface RunRecord {
  source: string
  appId?: string | null
  range?: DateRange
}

/**
 * Wraps a piece of work in a `sync_runs` row of the organization: 'running' when it starts, then
 * 'ok' with the row count or 'error' with the message. Errors are recorded and rethrown. The row
 * is written in units of work of its own, so the work in between holds no transaction open.
 */
export async function recordRun(
  scope: Scope,
  record: RunRecord,
  work: () => Promise<{ rowsWritten: number }>,
): Promise<{ rowsWritten: number }> {
  const [run] = await scope.run((db) =>
    db
      .insert(syncRuns)
      .values({
        organizationId: scope.organizationId,
        source: record.source,
        appId: record.appId ?? null,
        status: 'running',
        rangeFrom: record.range?.from,
        rangeTo: record.range?.to,
      })
      .returning({ id: syncRuns.id }),
  )
  if (!run) throw new Error('could not create sync_runs row')

  try {
    const result = await work()
    await scope.run((db) =>
      db
        .update(syncRuns)
        .set({ status: 'ok', rowsWritten: result.rowsWritten, finishedAt: new Date() })
        .where(and(eq(syncRuns.organizationId, scope.organizationId), eq(syncRuns.id, run.id))),
    )
    return result
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await scope.run((db) =>
      db
        .update(syncRuns)
        .set({ status: 'error', error: message.slice(0, 2000), finishedAt: new Date() })
        .where(and(eq(syncRuns.organizationId, scope.organizationId), eq(syncRuns.id, run.id))),
    )
    throw err
  }
}

export interface SyncOptions {
  /** The organization to sync. A sync never reads or writes another organization's rows. */
  organizationId: string
  connectors: Connector[]
  range: DateRange
  /** Limit to these sources; all registered connectors when omitted. */
  sources?: string[]
  /** Limit to these apps of the organization; all its active apps when omitted. */
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
 * Runs every selected connector for one organization: once per app, or once in all for a connector that covers a
 * whole account. One failing source or app never stops the others: each run is recorded on its
 * own. Cron entries can overlap safely because a second invocation for the same organization
 * exits immediately while the first holds its advisory lock.
 */
export async function runSync(
  deps: SyncDeps,
  options: SyncOptions,
): Promise<SyncSummary> {
  const { db, sql, log, secrets } = deps
  const { organizationId } = options
  // Row-level security holds the whole sync to this organization; see organizations/scope.ts.
  const scope = scopeFor(db, organizationId)
  const summary: SyncSummary = { skipped: false, ok: 0, failed: 0 }

  // Advisory locks belong to a session, so the lock and unlock must use the same connection.
  const reserved = await sql.reserve()
  try {
    const [lock] = await reserved<{ locked: boolean }[]>`
      select pg_try_advisory_lock(${SYNC_LOCK_ID}, hashtext(${organizationId})) as locked
    `
    if (!lock?.locked) {
      log.warn('Another sync is still running; skipping this one.')
      return { ...summary, skipped: true }
    }

    try {
      const selected = options.connectors.filter(
        (c) => !options.sources || options.sources.includes(c.source),
      )
      const activeApps = await scope.run((db) =>
        db
          .select()
          .from(apps)
          .where(
            and(
              eq(apps.organizationId, organizationId),
              eq(apps.isActive, true),
              options.appIds ? inArray(apps.id, options.appIds) : undefined,
            ),
          ),
      )

      const run = async (label: string, record: RunRecord, work: () => Promise<{ rowsWritten: number }>) => {
        try {
          const { rowsWritten } = await recordRun(scope, record, work)
          summary.ok++
          log.info(`${label}: ${rowsWritten} rows`)
        } catch (err) {
          summary.failed++
          log.error(`${label}: ${err instanceof Error ? err.message : err}`)
          reportError(err, { sync: record.source })
        }
      }

      for (const connector of selected) {
        const context = { ...scope, range: options.range, log, secrets }

        if (connector.scope === 'account') {
          if (!(await connector.isConfigured(scope))) continue
          await run(connector.source, { source: connector.source, range: options.range }, () =>
            connector.sync({ ...context, apps: activeApps }),
          )
          continue
        }

        for (const app of activeApps) {
          if (!(await connector.isConfigured(app, scope))) continue
          await run(
            `${connector.source} ${app.id}`,
            { source: connector.source, appId: app.id, range: options.range },
            () => connector.sync({ ...context, app }),
          )
        }
      }
    } finally {
      await reserved`select pg_advisory_unlock(${SYNC_LOCK_ID}, hashtext(${organizationId}))`
    }
  } finally {
    reserved.release()
  }

  return summary
}
