import { generateKeyPairSync, verify } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { GoogleAuthError, STORAGE_READ_SCOPE, createAssertion, createTokenSource, type ServiceAccount } from './auth.js'

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const account: ServiceAccount = {
  type: 'service_account',
  client_email: 'reports@my-project.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
}
const decode = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString()) as Record<string, unknown>

describe('Google service account sign-in', () => {
  it('signs an RS256 assertion Google can verify', () => {
    const assertion = createAssertion(account, STORAGE_READ_SCOPE, new Date('2026-11-22T10:00:00Z'))
    const [header = '', payload = '', signature = ''] = assertion.split('.')

    expect(decode(header)).toEqual({ alg: 'RS256', typ: 'JWT' })
    expect(decode(payload)).toEqual({
      iss: account.client_email,
      scope: STORAGE_READ_SCOPE,
      aud: 'https://oauth2.googleapis.com/token',
      iat: 1795341600,
      exp: 1795345200,
    })
    expect(verify('sha256', Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, 'base64url'))).toBe(true)
  })

  it('trades the assertion for an access token and reuses it until close to expiry', async () => {
    let calls = 0
    const fetchToken = (async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      calls++
      const form = new URLSearchParams(String(init?.body))
      expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer')
      return new Response(JSON.stringify({ access_token: `ya29.${calls}`, expires_in: 3599 }))
    }) as typeof fetch
    let clock = new Date('2026-11-22T10:00:00Z')
    const token = createTokenSource(account, STORAGE_READ_SCOPE, { fetch: fetchToken, now: () => clock })

    expect(await token()).toBe('ya29.1')
    expect(await token()).toBe('ya29.1')
    clock = new Date('2026-11-22T10:59:30Z')
    expect(await token()).toBe('ya29.2')
  })

  it('reports a refused key with Google\'s error code', async () => {
    const refuse = (async () =>
      new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'Invalid JWT Signature.' }), {
        status: 400,
      })) as typeof fetch
    const error = await createTokenSource(account, STORAGE_READ_SCOPE, { fetch: refuse })().catch((err: unknown) => err)
    expect(error).toBeInstanceOf(GoogleAuthError)
    expect(error).toMatchObject({ code: 'invalid_grant', message: 'Invalid JWT Signature.' })
  })
})
