import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { MetaError, createMetaClient } from './client.js'
import type { MetaConfig } from './config.js'
import { dayEndingAt, pacificMidnight, parseMetaTime } from './days.js'

const config: MetaConfig = {
  appId: 'app1',
  appSecret: 'secret1',
  loginConfigId: 'cfg1',
  graphUrl: 'https://graph.facebook.com',
  dialogUrl: 'https://www.facebook.com',
}

function fakeFetch(replies: { status?: number; body: unknown }[]) {
  const calls: URL[] = []
  const impl = (async (input: Parameters<typeof fetch>[0]) => {
    calls.push(new URL(String(input)))
    const reply = replies.shift()
    if (!reply) throw new Error('unexpected request')
    return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200 })
  }) as typeof fetch
  return { impl, calls }
}

describe('Meta days', () => {
  it('finds midnight in Los Angeles in winter and in summer', () => {
    expect(new Date(pacificMidnight('2026-11-20') * 1000).toISOString()).toBe('2026-11-20T08:00:00.000Z')
    expect(new Date(pacificMidnight('2026-07-04') * 1000).toISOString()).toBe('2026-07-04T07:00:00.000Z')
  })

  it('files a daily value under the day its end_time closes', () => {
    expect(dayEndingAt('2026-11-21T08:00:00+0000')).toBe('2026-11-20')
    expect(dayEndingAt('2026-07-05T07:00:00+0000')).toBe('2026-07-04')
  })

  it('reads Meta offsets without a colon', () => {
    expect(parseMetaTime('2026-11-20T15:04:05+0000').toISOString()).toBe('2026-11-20T15:04:05.000Z')
  })
})

describe('Meta client', () => {
  it('signs in with the Login for Business configuration, or with scopes without one', () => {
    const withConfig = new URL(
      createMetaClient({ config }).authorizeUrl({ redirectUri: 'https://d.example/cb', state: 's' }),
    )
    expect(withConfig.pathname).toBe('/v27.0/dialog/oauth')
    expect(withConfig.searchParams.get('config_id')).toBe('cfg1')
    expect(withConfig.searchParams.has('scope')).toBe(false)

    const withScope = new URL(
      createMetaClient({ config: { ...config, loginConfigId: null } }).authorizeUrl({
        redirectUri: 'https://d.example/cb',
        state: 's',
      }),
    )
    expect(withScope.searchParams.get('scope')).toContain('instagram_manage_insights')
  })

  it('signs every call with an appsecret_proof of its token', async () => {
    const { impl, calls } = fakeFetch([{ body: { id: 'u1', name: 'Vadim' } }])
    await createMetaClient({ config, fetch: impl }).me('user-token')

    const expected = createHmac('sha256', 'secret1').update('user-token').digest('hex')
    expect(calls[0]?.pathname).toBe('/v27.0/me')
    expect(calls[0]?.searchParams.get('appsecret_proof')).toBe(expected)
  })

  it('follows paging.next for lists', async () => {
    const { impl, calls } = fakeFetch([
      {
        body: {
          data: [{ id: 'p1', name: 'One', access_token: 't1' }],
          paging: { next: 'https://graph.facebook.com/v27.0/me/accounts?after=x' },
        },
      },
      { body: { data: [{ id: 'p2', name: 'Two', access_token: 't2' }], paging: {} } },
    ])
    const pages = await createMetaClient({ config, fetch: impl }).pages('user-token')
    expect(pages.map((page) => page.id)).toEqual(['p1', 'p2'])
    expect(calls[1]?.searchParams.get('after')).toBe('x')
  })

  it('splits Page insights into windows of at most 90 days', async () => {
    const value = (end: string, v: number) => ({ value: v, end_time: end })
    const { impl, calls } = fakeFetch([
      { body: { data: [{ name: 'page_media_view', values: [value('2026-03-02T08:00:00+0000', 5)] }] } },
      { body: { data: [{ name: 'page_media_view', values: [value('2026-05-31T07:00:00+0000', 7)] }] } },
    ])
    const points = await createMetaClient({ config, fetch: impl }).pageMetric(
      'page-token',
      'page1',
      'page_media_view',
      '2026-03-01',
      '2026-06-15',
    )
    expect(points.map((point) => point.value)).toEqual([5, 7])
    expect(calls).toHaveLength(2)
    expect(calls[0]?.searchParams.get('period')).toBe('day')
  })

  it('turns a Graph error into a MetaError that knows an expired sign-in', async () => {
    const { impl } = fakeFetch([
      {
        status: 400,
        body: { error: { message: 'Session has expired', code: 190, error_subcode: 463, fbtrace_id: 'tr' } },
      },
    ])
    const error = await createMetaClient({ config, fetch: impl })
      .me('old-token')
      .catch((err: unknown) => err)
    expect(error).toBeInstanceOf(MetaError)
    expect(error).toMatchObject({ code: 190, subcode: 463, isAuthProblem: true, isRateLimit: false })
  })

  it('falls back to plain post fields when a Page refuses the counts', async () => {
    const { impl, calls } = fakeFetch([
      { status: 400, body: { error: { message: 'Unsupported field', code: 100 } } },
      { body: { data: [{ id: 'p_1', created_time: '2026-11-01T10:00:00+0000' }] } },
    ])
    const posts = await createMetaClient({ config, fetch: impl }).pagePosts('t', 'page1', 0)
    expect(posts).toHaveLength(1)
    expect(calls[1]?.searchParams.get('fields')).toBe('id,created_time,message,permalink_url')
  })
})
