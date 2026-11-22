import { runSync, type SyncDeps, type SyncOptions } from './runner.js'

/** How long to wait before trying again when another sync holds the lock, and how often. */
const RETRY_MS = 20_000
const MAX_TRIES = 15

/**
 * Starts a sync without waiting for it. The API is a long-running process, so the work carries
 * on after the request that asked for it has been answered; progress shows up in `sync_runs`.
 *
 * If another sync holds the lock, this one waits and tries again (for about five minutes), so
 * connecting two accounts in a row fetches both histories instead of silently skipping one.
 */
export function startSync(
  deps: SyncDeps,
  options: SyncOptions,
  timing: { retryMs?: number; maxTries?: number } = {},
): void {
  const retryMs = timing.retryMs ?? RETRY_MS
  const maxTries = timing.maxTries ?? MAX_TRIES

  const attempt = (tries: number) => {
    runSync(deps, options)
      .then((summary) => {
        if (summary.skipped) {
          if (tries < maxTries) {
            setTimeout(() => attempt(tries + 1), retryMs).unref()
            return
          }
          deps.log.warn(`background sync gave up after ${tries} tries: another sync kept running`)
          return
        }
        deps.log.info(`background sync finished: ${summary.ok} ok, ${summary.failed} failed`)
      })
      .catch((err: unknown) => {
        deps.log.error(`background sync crashed: ${err instanceof Error ? err.message : String(err)}`)
      })
  }
  attempt(1)
}
