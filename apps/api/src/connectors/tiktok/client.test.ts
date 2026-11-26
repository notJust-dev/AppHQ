import { describe, expect, it } from 'vitest'
import { TikTokError, createTikTokClient } from './client.js'
import type { TikTokConfig } from './config.js'

type Reply = { status?: number; body: unknown; headers?: Record<string, string> }

interface Call {
  url: URL
  method: string
  headers: Headers
  body: string | undefined
}

/** A fetch stand-in that answers from a queue and records what it was asked. */
function fakeFetch(replies: Reply[]) {
  const calls: Call[] = []
  const impl = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    calls.push({
      url: new URL(String(input)),
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: init?.body === undefined ? undefined : String(init.body),
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

const config: TikTokConfig = {
  clientKey: 'ck_test',
  clientSecret: 'cs_test',
  apiUrl: 'https://open.tiktokapis.com',
  authorizeUrl: 'https://www.tiktok.com/v2/auth/authorize/',
}
const now = () => new Date('2026-11-22T10:00:00Z')
const ok = { code: 'ok', message: '', log_id: 'log1' }

describe('TikTok client', () => {
  it('builds the sign-in URL with comma-separated scopes', () => {
    const client = createTikTokClient({ config })
    const url = new URL(
      client.authorizeUrl({ redirectUri: 'https://dash.example/connect/tiktok/callback', state: 's1' }),
    )
    expect(url.origin + url.pathname).toBe('https://www.tiktok.com/v2/auth/authorize/')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_key: 'ck_test',
      scope: 'user.info.basic,user.info.profile,user.info.stats,video.list',
      response_type: 'code',
      redirect_uri: 'https://dash.example/connect/tiktok/callback',
      state: 's1',
      disable_auto_auth: '1',
    })
  })

  it('exchanges a code with a form-encoded body and works out the expiry times', async () => {
    const { impl, calls } = fakeFetch([
      {
        body: {
          access_token: 'act.1',
          expires_in: 7200,
          refresh_token: 'rft.1',
          refresh_expires_in: 15_552_000,
          open_id: 'open-1',
          scope: 'user.info.basic,video.list',
          token_type: 'Bearer',
        },
      },
    ])
    const client = createTikTokClient({ config, fetch: impl, now })

    const tokens = await client.exchangeCode({ code: 'c1', redirectUri: 'https://dash.example/cb' })

    const [call] = calls
    expect(call?.url.pathname).toBe('/v2/oauth/token/')
    expect(call?.headers.get('content-type')).toBe('application/x-www-form-urlencoded')
    expect(Object.fromEntries(new URLSearchParams(call?.body))).toEqual({
      client_key: 'ck_test',
      client_secret: 'cs_test',
      code: 'c1',
      grant_type: 'authorization_code',
      redirect_uri: 'https://dash.example/cb',
    })
    expect(tokens).toEqual({
      accessToken: 'act.1',
      refreshToken: 'rft.1',
      expiresAt: new Date('2026-11-22T12:00:00Z'),
      refreshExpiresAt: new Date('2027-05-21T10:00:00Z'),
      openId: 'open-1',
      scopes: ['user.info.basic', 'video.list'],
    })
  })

  it('turns an OAuth error into a TikTokError with its code', async () => {
    const { impl } = fakeFetch([
      {
        status: 400,
        body: { error: 'invalid_grant', error_description: 'Refresh token is expired.', log_id: 'l2' },
      },
    ])
    const client = createTikTokClient({ config, fetch: impl })

    const error = await client.refresh('rft.old').catch((err: unknown) => err)
    expect(error).toBeInstanceOf(TikTokError)
    expect(error).toMatchObject({ code: 'invalid_grant', message: 'Refresh token is expired.' })
    expect((error as TikTokError).isAuthProblem).toBe(true)
  })

  it('only asks for the user fields the granted scopes allow', async () => {
    const { impl, calls } = fakeFetch([
      { body: { data: { user: { open_id: 'open-1', display_name: 'Kicks' } }, error: ok } },
    ])
    const client = createTikTokClient({ config, fetch: impl })

    const user = await client.getUser('act.1', ['user.info.basic', 'video.list'])

    expect(user.display_name).toBe('Kicks')
    expect(calls[0]?.method).toBe('GET')
    expect(calls[0]?.headers.get('authorization')).toBe('Bearer act.1')
    expect(calls[0]?.url.searchParams.get('fields')).toBe('open_id,display_name,avatar_url')
  })

  it('pages through every video with the cursor', async () => {
    const video = (id: string) => ({ id, create_time: 1_763_000_000, view_count: 10 })
    const { impl, calls } = fakeFetch([
      { body: { data: { videos: [video('v1'), video('v2')], cursor: 111, has_more: true }, error: ok } },
      { body: { data: { videos: [video('v3')], cursor: 99, has_more: false }, error: ok } },
    ])
    const client = createTikTokClient({ config, fetch: impl })

    const videos = await client.listVideos('act.1')

    expect(videos.map((v) => v.id)).toEqual(['v1', 'v2', 'v3'])
    expect(calls.map((c) => c.method)).toEqual(['POST', 'POST'])
    expect(calls[0]?.url.pathname).toBe('/v2/video/list/')
    expect(JSON.parse(calls[0]?.body ?? '')).toEqual({ max_count: 20 })
    expect(JSON.parse(calls[1]?.body ?? '')).toEqual({ max_count: 20, cursor: 111 })
    expect(calls[0]?.url.searchParams.get('fields')).toContain('view_count')
  })

  it('asks for videos by id, twenty at a time', async () => {
    const ids = Array.from({ length: 23 }, (_, index) => `v${index + 1}`)
    const { impl, calls } = fakeFetch([
      { body: { data: { videos: [{ id: 'v1', create_time: 1_763_000_000, view_count: 10 }] }, error: ok } },
      { body: { data: { videos: [{ id: 'v22', create_time: 1_763_000_000, view_count: 4 }] }, error: ok } },
    ])
    const client = createTikTokClient({ config, fetch: impl })

    const videos = await client.queryVideos('act.1', ids)

    // Only the videos TikTok found come back.
    expect(videos.map((v) => [v.id, v.view_count])).toEqual([
      ['v1', 10],
      ['v22', 4],
    ])
    expect(calls.map((c) => [c.method, c.url.pathname])).toEqual([
      ['POST', '/v2/video/query/'],
      ['POST', '/v2/video/query/'],
    ])
    expect(JSON.parse(calls[0]?.body ?? '')).toEqual({ filters: { video_ids: ids.slice(0, 20) } })
    expect(JSON.parse(calls[1]?.body ?? '')).toEqual({ filters: { video_ids: ['v21', 'v22', 'v23'] } })
    expect(calls[0]?.url.searchParams.get('fields')).toContain('view_count')
    expect(calls[0]?.headers.get('authorization')).toBe('Bearer act.1')
  })

  it('reports a Display API error by its code', async () => {
    const { impl } = fakeFetch([
      {
        status: 401,
        body: { data: {}, error: { code: 'access_token_invalid', message: 'expired', log_id: 'l3' } },
      },
    ])
    const client = createTikTokClient({ config, fetch: impl })

    await expect(client.listVideos('act.old')).rejects.toMatchObject({
      code: 'access_token_invalid',
      status: 401,
    })
  })

  it('waits and retries when rate limited', async () => {
    const { impl, calls } = fakeFetch([
      { status: 429, body: { error: { code: 'rate_limit_exceeded' } }, headers: { 'retry-after': '2' } },
      { body: { data: { user: { open_id: 'open-1' } }, error: ok } },
    ])
    const waits: number[] = []
    const client = createTikTokClient({ config, fetch: impl, sleep: async (ms) => void waits.push(ms) })

    await client.getUser('act.1', [])

    expect(waits).toEqual([2000])
    expect(calls).toHaveLength(2)
  })
})
