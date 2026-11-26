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

describe('ALLOW_DASHBOARD_PASSWORD', () => {
  const base = { ...token, DATABASE_URL: 'postgres://u:p@127.0.0.1/db' }

  it('is on when unset or empty, so existing installs keep working', () => {
    expect(loadEnv(base).ALLOW_DASHBOARD_PASSWORD).toBe(true)
    expect(loadEnv({ ...base, ALLOW_DASHBOARD_PASSWORD: '' }).ALLOW_DASHBOARD_PASSWORD).toBe(true)
    expect(loadEnv({ ...base, ALLOW_DASHBOARD_PASSWORD: 'true' }).ALLOW_DASHBOARD_PASSWORD).toBe(true)
  })

  it('is off with false', () => {
    expect(loadEnv({ ...base, ALLOW_DASHBOARD_PASSWORD: 'false' }).ALLOW_DASHBOARD_PASSWORD).toBe(false)
  })

  it.each(['0', 'no', 'off', 'False', 'yes'])('refuses %j rather than guess', (value) => {
    expect(() => loadEnv({ ...base, ALLOW_DASHBOARD_PASSWORD: value })).toThrow(/ALLOW_DASHBOARD_PASSWORD/)
  })
})
