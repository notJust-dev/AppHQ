import { describe, expect, it } from 'vitest'
import { loadEnv } from './env.js'

const token = { INTERNAL_API_TOKEN: 'x'.repeat(32) }

describe('loadEnv', () => {
  it('accepts a DATABASE_URL', () => {
    const env = loadEnv({ ...token, DATABASE_URL: 'postgres://u:p@127.0.0.1:5432/db' })
    expect(env.DATABASE_URL).toBe('postgres://u:p@127.0.0.1:5432/db')
    expect(env.PORT).toBe(3000)
    expect(env.HOST).toBe('127.0.0.1')
  })

  it('accepts the PG* variables Velocity injects, without a DATABASE_URL', () => {
    const env = loadEnv({ ...token, PGHOST: 'localhost', PGDATABASE: 'db', PGUSER: 'u' })
    expect(env.DATABASE_URL).toBeUndefined()
  })

  it('rejects a configuration with no database at all', () => {
    expect(() => loadEnv(token)).toThrow(/DATABASE_URL/)
  })

  it('rejects a short internal token', () => {
    expect(() =>
      loadEnv({ INTERNAL_API_TOKEN: 'short', DATABASE_URL: 'postgres://u:p@127.0.0.1/db' }),
    ).toThrow(/INTERNAL_API_TOKEN/)
  })
})
