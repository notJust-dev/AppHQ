import { runSync, type SyncDeps, type SyncOptions } from './runner.js'

/**
 * Starts a sync without waiting for it. The API is a long-running process, so the work carries
 * on after the request that asked for it has been answered; progress shows up in `sync_runs`.
 * If another sync holds the lock this one is skipped, which the log records.
 */
export function startSync(deps: SyncDeps, options: SyncOptions): void {
  runSync(deps, options)
    .then((summary) => {
      deps.log.info(
        summary.skipped
          ? 'background sync skipped: another sync is running'
          : `background sync finished: ${summary.ok} ok, ${summary.failed} failed`,
      )
    })
    .catch((err: unknown) => {
      deps.log.error(`background sync crashed: ${err instanceof Error ? err.message : String(err)}`)
    })
}
