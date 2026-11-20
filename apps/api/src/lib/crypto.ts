import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

/**
 * Encryption for credentials stored in the database (API keys, OAuth tokens): AES-256-GCM with a
 * random nonce per value. The key is 32 bytes as 64 hex characters, from ENCRYPTION_KEY.
 * Format: v1:<nonce>:<auth tag>:<ciphertext>, each part base64.
 */

const VERSION = 'v1'
const KEY_PATTERN = /^[0-9a-f]{64}$/i

function toKey(keyHex: string): Buffer {
  if (!KEY_PATTERN.test(keyHex)) throw new Error('ENCRYPTION_KEY must be 64 hex characters')
  return Buffer.from(keyHex, 'hex')
}

export function encrypt(plaintext: string, keyHex: string): string {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', toKey(keyHex), nonce)
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return [VERSION, nonce, cipher.getAuthTag(), data]
    .map((part) => (typeof part === 'string' ? part : part.toString('base64')))
    .join(':')
}

export function decrypt(payload: string, keyHex: string): string {
  const [version, nonce, tag, data] = payload.split(':')
  if (version !== VERSION || !nonce || !tag || data === undefined) {
    throw new Error('Stored credential is not in a recognised format')
  }
  const decipher = createDecipheriv('aes-256-gcm', toKey(keyHex), Buffer.from(nonce, 'base64'))
  decipher.setAuthTag(Buffer.from(tag, 'base64'))
  // final() throws if the key is wrong or the value was altered.
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString(
    'utf8',
  )
}

export interface Secrets {
  encrypt(plaintext: string): string
  decrypt(payload: string): string
}

/** Thrown when a credential is needed but the API was started without ENCRYPTION_KEY. */
export class MissingEncryptionKeyError extends Error {
  constructor() {
    super('ENCRYPTION_KEY is not set on the API, so credentials cannot be stored or read.')
  }
}

/**
 * The API boots without ENCRYPTION_KEY so that a missing variable cannot take the whole service
 * down; only the operations that touch stored credentials fail, with a clear message.
 */
export function createSecrets(keyHex: string | undefined): Secrets {
  const key = () => {
    if (!keyHex) throw new MissingEncryptionKeyError()
    return keyHex
  }
  return {
    encrypt: (plaintext) => encrypt(plaintext, key()),
    decrypt: (payload) => decrypt(payload, key()),
  }
}
