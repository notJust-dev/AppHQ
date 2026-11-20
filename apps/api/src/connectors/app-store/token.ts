import { createPrivateKey, sign } from 'node:crypto'

export interface AppStoreCredentials {
  /** Issuer ID from Users and Access, Integrations, App Store Connect API. */
  issuerId: string
  keyId: string
  /** Contents of the .p8 file. */
  privateKey: string
  /** From Payments and Financial Reports; sales reports are requested per vendor. */
  vendorNumber: string
}

/** Apple rejects tokens that live longer than 20 minutes. */
const LIFETIME_SECONDS = 15 * 60

const base64url = (value: Buffer | string) => Buffer.from(value).toString('base64url')

/**
 * A signed token for the App Store Connect API: an ES256 JWT made from a team API key.
 * Individual keys are not supported, because Apple does not let them read sales reports.
 */
export function createAppStoreToken(
  credentials: Pick<AppStoreCredentials, 'issuerId' | 'keyId' | 'privateKey'>,
  now: Date = new Date(),
): string {
  const issuedAt = Math.floor(now.getTime() / 1000)
  const header = { alg: 'ES256', kid: credentials.keyId, typ: 'JWT' }
  const payload = {
    iss: credentials.issuerId,
    iat: issuedAt,
    exp: issuedAt + LIFETIME_SECONDS,
    aud: 'appstoreconnect-v1',
  }
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`
  const signature = sign('sha256', Buffer.from(signingInput), {
    key: createPrivateKey(credentials.privateKey),
    // JWTs carry the raw r||s signature, not the DER encoding Node produces by default.
    dsaEncoding: 'ieee-p1363',
  })
  return `${signingInput}.${base64url(signature)}`
}

/** True when the text is a private key Node can load. Used to reject a bad paste early. */
export function isPrivateKey(pem: string): boolean {
  try {
    return createPrivateKey(pem).asymmetricKeyType === 'ec'
  } catch {
    return false
  }
}
