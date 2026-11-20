import { desc } from 'drizzle-orm'
import { z } from 'zod'
import { syncRuns } from '../db/schema.js'
import { defineQuery } from './define.js'

export const getSyncStatus = defineQuery({
  name: 'get_sync_status',
  description:
    'The most recent sync run for each data source: when it ran, whether it succeeded, how ' +
    'many rows it wrote, and the error if it failed.',
  input: z.void(),
  async handler({ db }) {
    const latest = await db
      .selectDistinctOn([syncRuns.source], {
        source: syncRuns.source,
        status: syncRuns.status,
        startedAt: syncRuns.startedAt,
        finishedAt: syncRuns.finishedAt,
        rowsWritten: syncRuns.rowsWritten,
        error: syncRuns.error,
      })
      .from(syncRuns)
      .orderBy(syncRuns.source, desc(syncRuns.startedAt))

    return latest.map((run) => ({
      ...run,
      startedAt: run.startedAt.toISOString(),
      finishedAt: run.finishedAt?.toISOString() ?? null,
    }))
  },
})
