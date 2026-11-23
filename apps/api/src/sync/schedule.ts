import { and, desc, eq } from 'drizzle-orm'
import type { Connector } from '../connectors/types.js'
import { syncRuns } from '../db/schema.js'
import { trailingRange } from '../lib/dates.js'
import { recordRun, runSync, type SyncDeps } from './runner.js'

/** The `sync_runs` source of a scheduled sync; the Accounts page calls it "Scheduled sync". */
export const SCHEDULED = 'scheduled'

/** How many days each scheduled sync re-reads: Google Play posts 3 to 7 days late. */
export const SCHEDULED_DAYS = 10

/** How often the API checks whether a sync is due, and how long it waits after starting. */
const CHECK_EVERY_MS = 5 * 60_000
const FIRST_CHECK_MS = 2 * 60_000

/** Whether a scheduled sync is due: none has finished yet, or the last one started long enough ago. */
export function isDue(lastStartedAt: Date | null, now: Date, intervalMs: number): boolean {
  return lastStartedAt === null || now.getTime() - lastStartedAt.getTime() >= intervalMs
}

/** When the last scheduled sync that finished started, or null if none has. */
async function lastScheduledSync(deps: SyncDeps): Promise<Date | null> {
  const [last] = await deps.db
    .select({ startedAt: syncRuns.startedAt })
    .from(syncRuns)
    .where(and(eq(syncRuns.source, SCHEDULED), eq(syncRuns.status, 'ok')))
    .orderBy(desc(syncRuns.startedAt))
    .limit(1)
  return last?.startedAt ?? null
}

/**
 * Runs one scheduled sync of every source if one is due. The time of the last one is read from
 * `sync_runs`, not kept in memory, so a deploy (which restarts the API) neither skips a sync nor
 * starts an extra one. A sync that could not run because another held the lock is recorded as an
 * error and does not count, so the next check tries again.
 */
export async function syncIfDue(
  deps: SyncDeps,
  options: { connectors: Connector[]; intervalMs: number; now?: Date },
): Promise<'ran' | 'not-due'> {
  const now = options.now ?? new Date()
  if (!isDue(await lastScheduledSync(deps), now, options.intervalMs)) return 'not-due'

  await recordRun(deps.db, { source: SCHEDULED }, async () => {
    const summary = await runSync(deps, { connectors: options.connectors, range: trailingRange(SCHEDULED_DAYS, now) })
    if (summary.skipped) throw new Error('Another sync was running; trying again shortly.')
    deps.log.info(`scheduled sync finished: ${summary.ok} ok, ${summary.failed} failed`)
    // Each source's own row holds what it wrote; this row only marks that the schedule ran.
    return { rowsWritten: 0 }
  })
  return 'ran'
}

/**
 * Keeps the data fresh from inside the API, which is always running and already has every
 * variable a sync needs (a Velocity cron command does not get them). Checks every few minutes
 * and syncs when the last scheduled sync is `intervalHours` old. Returns a function that stops it.
 */
export function startSyncSchedule(
  deps: SyncDeps,
  options: { connectors: Connector[]; intervalHours: number },
): () => void {
  const intervalMs = options.intervalHours * 3_600_000
  let busy = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const check = async () => {
    if (busy) return
    busy = true
    try {
      await syncIfDue(deps, { connectors: options.connectors, intervalMs })
    } catch (err) {
      deps.log.error(`scheduled sync failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      busy = false
      timer = setTimeout(check, CHECK_EVERY_MS)
      timer.unref()
    }
  }

  timer = setTimeout(check, FIRST_CHECK_MS)
  timer.unref()
  deps.log.info(`sync schedule on: every ${options.intervalHours} h, ${SCHEDULED_DAYS} days each`)
  return () => clearTimeout(timer)
}
