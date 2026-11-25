import type { Db } from '../db/client.js'
import type { Scope } from '../organizations/scope.js'
import type { App } from '../db/schema.js'
import type { Secrets } from '../lib/crypto.js'
import type { DateRange } from '../lib/dates.js'
import type { Logger } from '../lib/logger.js'
import type { Source } from '../metrics/catalog.js'

interface SyncContext extends Scope {
  db: Db
  /** The organization being synced; a connector reads and writes only its rows. */
  organizationId: string
  /** Inclusive UTC days to fetch. Connectors must be safe to re-run over the same range. */
  range: DateRange
  log: Logger
  /** Decrypts credentials stored in `connections`. */
  secrets: Secrets
}

export interface AppSyncContext extends SyncContext {
  app: App
}

export interface AccountSyncContext extends SyncContext {
  /** Every app this run covers; the connector works out which ones the account has. */
  apps: App[]
}

/**
 * A source whose credentials belong to one app, such as a RevenueCat project key. The runner
 * calls it once per app.
 */
export interface AppConnector {
  source: Source
  scope: 'app'
  /** False when the app lacks the ids or credentials this source needs; the runner skips it. */
  isConfigured(app: App, scope: Scope): boolean | Promise<boolean>
  sync(ctx: AppSyncContext): Promise<{ rowsWritten: number }>
}

/**
 * A source where one login covers every app, such as App Store Connect, whose daily sales
 * report lists all of the account's apps. The runner calls it once per run.
 */
export interface AccountConnector {
  source: Source
  scope: 'account'
  isConfigured(scope: Scope): boolean | Promise<boolean>
  sync(ctx: AccountSyncContext): Promise<{ rowsWritten: number }>
}

/**
 * One data source. A connector fetches a date range and upserts what it finds (see
 * `upsertMetrics`). The sync runner handles scheduling, locking and `sync_runs` rows.
 */
export type Connector = AppConnector | AccountConnector
