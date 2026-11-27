import { randomUUID } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '../db/client.js'
import { runMigrations } from '../db/migrate.js'
import { apps, posts } from '../db/schema.js'
import { upsertMetrics } from '../metrics/upsert.js'
import { testDatabaseUrl } from '../test/database.js'
import { defaultScope } from '../test/organizations.js'
import type { Scope } from '../organizations/scope.js'
import { listPosts } from './list-posts.js'

// Runs only when a database is provided: TEST_DATABASE_URL=postgres://.../appdashboard_test
const url = testDatabaseUrl()

describe.skipIf(!url)('Listing posts, against a real database', () => {
  const { db, sql } = createDb(url ?? 'postgres://unused')
  const first = randomUUID()
  const second = randomUUID()
  const range = { from: '2026-11-20', to: '2026-11-21', limit: 50 }
  let scope: Scope

  beforeAll(async () => {
    await runMigrations({ db, sql })
    scope = await defaultScope(db)
    const { organizationId } = scope
    await db.insert(apps).values([
      { organizationId, id: first, name: 'Posts Test One' },
      { organizationId, id: second, name: 'Posts Test Two' },
    ])
    await db.insert(posts).values([
      { organizationId, appId: first, platform: 'tiktok', externalId: `test-${first}`, publishedAt: new Date('2026-11-20T10:00:00Z'), views: 100 },
      { organizationId, appId: second, platform: 'youtube', externalId: `test-${second}`, publishedAt: new Date('2026-11-21T10:00:00Z'), views: 200 },
    ])
    // A steady week of downloads for the first app only, before and after its post.
    const days = ['2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19']
    await upsertMetrics(scope, [
      ...days.map((date) => ({ appId: first, date, source: 'app_store', metric: 'downloads', value: 10 })),
      ...['2026-11-20', '2026-11-21', '2026-11-22'].map((date) => ({ appId: first, date, source: 'app_store', metric: 'downloads', value: 20 })),
    ])
  })

  afterAll(async () => {
    await db.delete(apps).where(and(eq(apps.organizationId, scope.organizationId), inArray(apps.id, [first, second])))
    await sql.end({ timeout: 5 })
  })

  it('lists every app’s posts, newest first, each with its app, when no app is given', async () => {
    const ours = new Set<string>([first, second])
    const listed = (await listPosts.handler(scope, range)).filter((post) => ours.has(post.appId))

    expect(listed.map((post) => [post.appName, post.platform])).toEqual([
      ['Posts Test Two', 'youtube'],
      ['Posts Test One', 'tiktok'],
    ])
  })

  it('works out each post’s lift from its own app’s downloads', async () => {
    const listed = await listPosts.handler(scope, range)
    const liftOf = (appId: string) => listed.find((post) => post.appId === appId)?.downloadLift.status

    expect(liftOf(first)).toBe('ok')
    expect(liftOf(second)).toBe('no_downloads')
  })

  it('lists one app’s posts when one is given', async () => {
    const listed = await listPosts.handler(scope, { ...range, appId: first })

    expect(listed.map((post) => post.appId)).toEqual([first])
  })
})
