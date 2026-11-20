import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from './app.js'
import type { Db, Sql } from './db/client.js'
import { createSecrets } from './lib/crypto.js'

const TOKEN = 'test-token-that-is-at-least-32-characters'

// These tests stop before any query runs, so no database is needed.
const build = (pingDb: () => Promise<unknown> = async () => 1) =>
  buildApp({
    db: {} as Db,
    sql: {} as Sql,
    secrets: createSecrets(undefined),
    pingDb,
    internalApiToken: TOKEN,
    logLevel: 'silent',
  })

let app: Awaited<ReturnType<typeof build>> | undefined
afterEach(async () => {
  await app?.close()
  app = undefined
})

describe('GET /health', () => {
  it('is public and reports the database as up', async () => {
    app = await build()
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true, db: 'up' })
  })

  it('returns 503 when the database does not answer', async () => {
    app = await build(async () => {
      throw new Error('connection refused')
    })
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(503)
    expect(res.json()).toEqual({ ok: false, db: 'down' })
  })
})

describe('/trpc', () => {
  it('rejects requests without the internal token', async () => {
    app = await build()
    const res = await app.inject({ method: 'GET', url: '/trpc/apps.list' })
    expect(res.statusCode).toBe(401)
  })

  it('rejects a wrong token', async () => {
    app = await build()
    const res = await app.inject({
      method: 'GET',
      url: '/trpc/apps.list',
      headers: { authorization: 'Bearer not-the-token' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('lets the right token through to the router', async () => {
    app = await build()
    const res = await app.inject({
      method: 'GET',
      url: '/trpc/does.not.exist',
      headers: { authorization: `Bearer ${TOKEN}` },
    })
    // Past the guard: tRPC itself answers that the procedure is unknown.
    expect(res.statusCode).toBe(404)
  })
})
