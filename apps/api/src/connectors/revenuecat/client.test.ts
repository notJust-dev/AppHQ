import { describe, expect, it } from 'vitest'
import { RevenueCatError, createRevenueCatClient } from './client.js'

type Reply = { status?: number; body: unknown; headers?: Record<string, string> }

/** A fetch stand-in that answers from a queue and records what it was asked. */
function fakeFetch(replies: Reply[]) {
  const calls: { url: URL; authorization: string | null }[] = []
  const impl = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    calls.push({
      url: new URL(String(input)),
      authorization: new Headers(init?.headers).get('authorization'),
    })
    const reply = replies.shift()
    if (!reply) throw new Error('unexpected request')
    return new Response(JSON.stringify(reply.body), {
      status: reply.status ?? 200,
      headers: reply.headers,
    })
  }) as typeof fetch
  return { impl, calls }
}

const range = { from: '2026-11-01', to: '2026-11-19' }

describe('RevenueCat client', () => {
  it('asks for a daily chart in USD with the key as a bearer token', async () => {
    const { impl, calls } = fakeFetch([{ body: { values: [] } }])
    const client = createRevenueCatClient({ apiKey: 'sk_test', fetch: impl })

    await client.getDailyChart('proj1', 'revenue', range)

    const [call] = calls
    expect(call?.authorization).toBe('Bearer sk_test')
    expect(call?.url.pathname).toBe('/v2/projects/proj1/charts/revenue')
    expect(Object.fromEntries(call?.url.searchParams ?? [])).toEqual({
      realtime: 'true',
      resolution: '0',
      start_date: '2026-11-01',
      end_date: '2026-11-19',
      currency: 'USD',
    })
  })

  it('waits and retries when rate limited', async () => {
    const { impl, calls } = fakeFetch([
      { status: 429, body: { type: 'rate_limit_error', backoff_ms: 1500 } },
      { body: { values: [] } },
    ])
    const waits: number[] = []
    const client = createRevenueCatClient({
      apiKey: 'sk_test',
      fetch: impl,
      sleep: async (ms) => void waits.push(ms),
    })

    await client.getDailyChart('proj1', 'mrr', range)

    expect(waits).toEqual([1500])
    expect(calls).toHaveLength(2)
  })

  it('reports a rejected key as an auth problem', async () => {
    const { impl } = fakeFetch([
      { status: 401, body: { type: 'authentication_error', message: 'Invalid API key' } },
    ])
    const client = createRevenueCatClient({ apiKey: 'sk_bad', fetch: impl })

    const error = await client.listProjects().catch((err: unknown) => err)

    expect(error).toBeInstanceOf(RevenueCatError)
    expect(error).toMatchObject({ status: 401, type: 'authentication_error', isAuthProblem: true })
  })

  it('follows next_page until the list ends', async () => {
    const { impl, calls } = fakeFetch([
      {
        body: {
          items: [{ id: 'proj1', name: 'One' }],
          next_page: '/v2/projects?starting_after=proj1',
        },
      },
      { body: { items: [{ id: 'proj2', name: 'Two' }], next_page: null } },
    ])
    const client = createRevenueCatClient({ apiKey: 'sk_test', fetch: impl })

    const projects = await client.listProjects()

    expect(projects.map((project) => project.id)).toEqual(['proj1', 'proj2'])
    expect(calls[1]?.url.searchParams.get('starting_after')).toBe('proj1')
  })
})
