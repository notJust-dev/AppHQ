import { createPrivateKey, sign } from 'node:crypto'
import { z } from 'zod'

/**
 * Signing in as a Google Cloud service account without an SDK: an RS256 JWT made from the
 * account's JSON key, traded at Google's token endpoint for an access token that lasts an hour.
 */

export const STORAGE_READ_SCOPE = 'https://www.googleapis.com/auth/devstorage.read_only'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const LIFETIME_SECONDS = 3600

/** The parts of a service account JSON key file the dashboard uses. */
export const serviceAccountSchema = z.object({
  type: z.literal('service_account'),
  client_email: z.string().email(),
  private_key: z.string().includes('PRIVATE KEY'),
  token_uri: z.string().url().optional(),
})

export type ServiceAccount = z.infer<typeof serviceAccountSchema>

export class GoogleAuthError extends Error {
  constructor(
    readonly status: number,
    /** Google's OAuth error, e.g. `invalid_grant` for a deleted or disabled key. */
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'GoogleAuthError'
  }
}

const base64url = (value: Buffer | string) => Buffer.from(value).toString('base64url')

export function createAssertion(account: ServiceAccount, scope: string, now: Date = new Date()): string {
  const issuedAt = Math.floor(now.getTime() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const payload = {
    iss: account.client_email,
    scope,
    aud: account.token_uri ?? TOKEN_URL,
    iat: issuedAt,
    exp: issuedAt + LIFETIME_SECONDS,
  }
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`
  const signature = sign('sha256', Buffer.from(signingInput), createPrivateKey(account.private_key))
  return `${signingInput}.${base64url(signature)}`
}

const tokenResponse = z.object({ access_token: z.string(), expires_in: z.number().optional() })
const errorResponse = z.object({ error: z.string(), error_description: z.string().optional() })

/** An access token for `scope`, cached until a minute before it expires. */
export function createTokenSource(
  account: ServiceAccount,
  scope: string,
  options: { fetch?: typeof fetch; now?: () => Date; tokenUrl?: string } = {},
) {
  const doFetch = options.fetch ?? fetch
  const now = options.now ?? (() => new Date())
  let cached: { token: string; until: number } | undefined

  return async (): Promise<string> => {
    if (cached && cached.until > now().getTime()) return cached.token
    const response = await doFetch(options.tokenUrl ?? account.token_uri ?? TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: createAssertion(account, scope, now()),
      }),
      signal: AbortSignal.timeout(30_000),
    })
    const body: unknown = await response.json().catch(() => null)
    const ok = tokenResponse.safeParse(body)
    if (response.ok && ok.success) {
      const lifetime = (ok.data.expires_in ?? LIFETIME_SECONDS) * 1000
      cached = { token: ok.data.access_token, until: now().getTime() + lifetime - 60_000 }
      return cached.token
    }
    const error = errorResponse.safeParse(body).data
    throw new GoogleAuthError(
      response.status,
      error?.error ?? 'unexpected_response',
      error?.error_description || `Google's token endpoint answered ${response.status}`,
    )
  }
}
