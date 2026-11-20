/**
 * The database for tests that need Postgres, or undefined to skip them.
 *
 * These tests insert and delete real rows, including the single App Store account connection,
 * so they only run against a database whose name ends in `_test`.
 */
export function testDatabaseUrl(): string | undefined {
  const url = process.env.TEST_DATABASE_URL
  if (!url) return undefined
  if (!new URL(url).pathname.endsWith('_test')) {
    throw new Error('TEST_DATABASE_URL must point at a database whose name ends in "_test"')
  }
  return url
}
