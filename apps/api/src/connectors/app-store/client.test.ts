import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { AppStoreError, createAppStoreClient } from './client.js'
import { salesReport } from './fixtures.js'
import { createAppStoreToken, isPrivateKey } from './token.js'

const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const credentials = { issuerId: 'issuer-1', keyId: 'KEY123', privateKey: pem, vendorNumber: '85000001' }

type Reply = { status?: number; body: string | Buffer }

function fakeFetch(replies: Reply[]) {
  const calls: { url: URL; method: string; authorization: string | null; body: unknown }[] = []
  const impl = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    calls.push({
      url: new URL(String(input)),
      method: init?.method ?? 'GET',
      authorization: new Headers(init?.headers).get('authorization'),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    })
    const reply = replies.shift()
    if (!reply) throw new Error('unexpected request')
    return new Response(reply.body, { status: reply.status ?? 200 })
  }) as typeof fetch
  return { impl, calls }
}

const decode = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString())

describe('App Store Connect token', () => {
  it('is an ES256 JWT that the matching public key verifies', () => {
    const now = new Date('2026-11-20T10:00:00Z')
    const [header = '', payload = '', signature = ''] = createAppStoreToken(credentials, now).split('.')

    expect(decode(header)).toEqual({ alg: 'ES256', kid: 'KEY123', typ: 'JWT' })
    expect(decode(payload)).toEqual({
      iss: 'issuer-1',
      iat: 1795168800,
      exp: 1795168800 + 15 * 60,
      aud: 'appstoreconnect-v1',
    })
    const valid = verify(
      'sha256',
      Buffer.from(`${header}.${payload}`),
      { key: createPublicKey(pem), dsaEncoding: 'ieee-p1363' },
      Buffer.from(signature, 'base64url'),
    )
    expect(valid).toBe(true)
  })

  it('recognises a private key and rejects anything else', () => {
    expect(isPrivateKey(pem)).toBe(true)
    expect(isPrivateKey('not a key')).toBe(false)
  })
})

describe('App Store Connect client', () => {
  it('requests the daily summary sales report and unpacks it', async () => {
    const report = salesReport([{ appleId: '111', productType: '1F', units: 3 }])
    const { impl, calls } = fakeFetch([{ body: gzipSync(report) }])
    const client = createAppStoreClient({ credentials, fetch: impl })

    expect(await client.getDailySalesReport('2026-11-18')).toBe(report)

    const [call] = calls
    expect(call?.authorization).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/)
    expect(call?.url.pathname).toBe('/v1/salesReports')
    expect(Object.fromEntries(call?.url.searchParams ?? [])).toEqual({
      'filter[frequency]': 'DAILY',
      'filter[reportType]': 'SALES',
      'filter[reportSubType]': 'SUMMARY',
      'filter[vendorNumber]': '85000001',
      'filter[reportDate]': '2026-11-18',
      'filter[version]': '1_0',
    })
  })

  it('treats a missing report as "nothing for that day", not as a failure', async () => {
    const { impl } = fakeFetch([
      { status: 404, body: JSON.stringify({ errors: [{ code: 'NOT_FOUND', detail: 'none' }] }) },
    ])
    const client = createAppStoreClient({ credentials, fetch: impl })
    expect(await client.getDailySalesReport('2026-11-20')).toBeNull()
  })

  it("reports Apple's own explanation when a request is refused", async () => {
    const { impl } = fakeFetch([
      {
        status: 403,
        body: JSON.stringify({
          errors: [{ code: 'FORBIDDEN_ERROR', detail: 'This key cannot read sales reports.' }],
        }),
      },
    ])
    const client = createAppStoreClient({ credentials, fetch: impl })

    const error = await client.getDailySalesReport('2026-11-18').catch((err: unknown) => err)

    expect(error).toBeInstanceOf(AppStoreError)
    expect(error).toMatchObject({
      status: 403,
      code: 'FORBIDDEN_ERROR',
      message: 'This key cannot read sales reports.',
      isAuthProblem: true,
    })
  })

  it('lists apps across pages', async () => {
    const page = (id: string, next?: string) =>
      JSON.stringify({
        data: [{ id, attributes: { name: `App ${id}`, bundleId: `dev.example.${id}` } }],
        links: { next },
      })
    const { impl, calls } = fakeFetch([
      { body: page('111', 'https://api.appstoreconnect.apple.com/v1/apps?cursor=abc') },
      { body: page('222') },
    ])
    const client = createAppStoreClient({ credentials, fetch: impl })

    expect(await client.listApps()).toEqual([
      { appleId: '111', name: 'App 111', bundleId: 'dev.example.111' },
      { appleId: '222', name: 'App 222', bundleId: 'dev.example.222' },
    ])
    expect(calls[1]?.url.searchParams.get('cursor')).toBe('abc')
  })

  it('asks for ongoing or history analytics reports for an app', async () => {
    const { impl, calls } = fakeFetch([{ status: 201, body: '{}' }, { status: 409, body: '{}' }])
    const client = createAppStoreClient({ credentials, fetch: impl })

    await client.createReportRequest('111', 'ONE_TIME_SNAPSHOT')
    // A request that already exists is fine.
    await client.createReportRequest('111', 'ONGOING')

    expect(calls[0]).toMatchObject({
      method: 'POST',
      body: {
        data: {
          type: 'analyticsReportRequests',
          attributes: { accessType: 'ONE_TIME_SNAPSHOT' },
          relationships: { app: { data: { type: 'apps', id: '111' } } },
        },
      },
    })
  })

  it('lists report requests, marking ones Apple stopped', async () => {
    const { impl } = fakeFetch([
      {
        body: JSON.stringify({
          data: [
            { id: 'r1', attributes: { accessType: 'ONGOING', stoppedDueToInactivity: true } },
            { id: 'r2', attributes: { accessType: 'ONE_TIME_SNAPSHOT', stoppedDueToInactivity: false } },
          ],
        }),
      },
    ])
    const client = createAppStoreClient({ credentials, fetch: impl })

    expect(await client.listReportRequests('111')).toEqual([
      { id: 'r1', accessType: 'ONGOING', stopped: true },
      { id: 'r2', accessType: 'ONE_TIME_SNAPSHOT', stopped: false },
    ])
  })

  it('finds the Standard engagement report, not its Detailed twin', async () => {
    const report = (id: string, name: string) => ({ id, attributes: { name, category: 'APP_STORE_ENGAGEMENT' } })
    const { impl, calls } = fakeFetch([
      {
        body: JSON.stringify({
          data: [
            report('r15', 'App Store Discovery and Engagement Detailed'),
            report('r14', 'App Store Discovery and Engagement Standard'),
          ],
        }),
      },
    ])
    const client = createAppStoreClient({ credentials, fetch: impl })

    expect(await client.findEngagementReport('req-1')).toBe('r14')
    expect(calls[0]?.url.searchParams.get('filter[category]')).toBe('APP_STORE_ENGAGEMENT')
  })

  it("downloads an instance's files from their signed links, unzipped", async () => {
    const file = 'Date\tCounts\n2026-11-20\t3\n'
    const { impl, calls } = fakeFetch([
      {
        body: JSON.stringify({
          data: [{ attributes: { url: 'https://storage.example/one.gz' } }, { attributes: { url: 'https://storage.example/two' } }],
        }),
      },
      { body: gzipSync(file) },
      { body: file },
    ])
    const client = createAppStoreClient({ credentials, fetch: impl })

    expect(await client.downloadInstance('inst-1')).toEqual([file, file])
    expect(calls[0]?.url.pathname).toBe('/v1/analyticsReportInstances/inst-1/segments')
    // The signed link carries its own authorization; the API token is not sent to storage.
    expect(calls[1]?.authorization).toBeNull()
  })
})
