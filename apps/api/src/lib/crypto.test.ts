import { describe, expect, it } from 'vitest'
import { MissingEncryptionKeyError, createSecrets, decrypt, encrypt } from './crypto.js'

const key = 'a'.repeat(64)
const otherKey = 'b'.repeat(64)

describe('credential encryption', () => {
  it('round-trips a value', () => {
    expect(decrypt(encrypt('sk_secret_value', key), key)).toBe('sk_secret_value')
  })

  it('produces a different ciphertext every time', () => {
    expect(encrypt('same', key)).not.toBe(encrypt('same', key))
  })

  it('does not contain the plaintext', () => {
    expect(encrypt('sk_secret_value', key)).not.toContain('sk_secret_value')
  })

  it('refuses a value encrypted with another key', () => {
    expect(() => decrypt(encrypt('value', key), otherKey)).toThrow()
  })

  it('refuses a value that was altered', () => {
    const parts = encrypt('value', key).split(':')
    const data = Buffer.from(parts[3] ?? '', 'base64')
    data[0] = (data[0] ?? 0) ^ 1
    parts[3] = data.toString('base64')
    expect(() => decrypt(parts.join(':'), key)).toThrow()
  })

  it('rejects a malformed key or payload', () => {
    expect(() => encrypt('value', 'too-short')).toThrow(/64 hex/)
    expect(() => decrypt('not-a-payload', key)).toThrow(/recognised format/)
  })

  it('fails clearly when no key is configured', () => {
    const secrets = createSecrets(undefined)
    expect(() => secrets.encrypt('value')).toThrow(MissingEncryptionKeyError)
    expect(() => secrets.decrypt('v1:a:b:c')).toThrow(MissingEncryptionKeyError)
  })
})
