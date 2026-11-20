import type { Db } from '../db/client.js'
import type { App } from '../db/schema.js'
import type { DateRange } from '../lib/dates.js'
import type { Logger } from '../lib/logger.js'
import type { Source } from '../metrics/catalog.js'

export interface SyncContext {
  db: Db
  app: App
  /** Inclusive UTC days to fetch. Connectors must be safe to re-run over the same range. */
  range: DateRange
  log: Logger
}

/**
 * One data source. A connector fetches a date range for one app and upserts what it finds
 * (see `upsertMetrics`). The sync runner handles scheduling, locking and `sync_runs` rows.
 */
export interface Connector {
  source: Source
  /** False when the app lacks the ids or credentials this source needs; the runner skips it. */
  isConfigured(app: App, db: Db): boolean | Promise<boolean>
  sync(ctx: SyncContext): Promise<{ rowsWritten: number }>
}
