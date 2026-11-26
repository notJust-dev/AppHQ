import { describe, expect, it } from 'vitest'
import { createPasswordChecker, isPasswordSession, passwordFingerprint } from './password-session'

const SECRET = 'test-session-secret-that-is-at-least-32-characters'
const PASSWORD = 'test-password-long-enough'

describe('a password session', () => {
  const stored = passwordFingerprint(PASSWORD, SECRET)

  it('counts while the password it was made with is set', () => {
    expect(isPasswordSession(stored, PASSWORD, SECRET)).toBe(true)
  })

  it('stores neither the password nor anything that reads as "signed in"', () => {
    expect(stored).toMatch(/^[0-9a-f]{64}$/)
    expect(stored).not.toContain(PASSWORD)
    expect(passwordFingerprint(PASSWORD, 'another-session-secret-of-32-characters')).not.toBe(stored)
  })

  it('stops counting once the password changes', () => {
    expect(isPasswordSession(stored, 'a-different-password', SECRET)).toBe(false)
  })

  it('stops counting once the password is unset', () => {
    expect(isPasswordSession(stored, undefined, SECRET)).toBe(false)
    expect(isPasswordSession(stored, '', SECRET)).toBe(false)
  })

  it('stops counting once SESSION_SECRET changes', () => {
    expect(isPasswordSession(stored, PASSWORD, 'another-session-secret-of-32-characters')).toBe(false)
  })

  it.each([undefined, null, true, '', 'signedIn', stored.slice(1), `${stored}0`, stored.toUpperCase()])(
    'is not made by a stored value of %j',
    (value) => {
      expect(isPasswordSession(value, PASSWORD, SECRET)).toBe(false)
    },
  )

  it('is not made by an old cookie that only says signed in', () => {
    const old = { signedIn: true } as { signedIn?: boolean; password?: string }
    expect(isPasswordSession(old.password, PASSWORD, SECRET)).toBe(false)
  })
})

describe('checking the password', () => {
  it('accepts the password and refuses anything else', () => {
    const check = createPasswordChecker()
    expect(check(PASSWORD, PASSWORD, '198.51.100.1')).toBe('ok')
    expect(check('wrong', PASSWORD, '198.51.100.1')).toBe('wrong')
    expect(check('', PASSWORD, '198.51.100.1')).toBe('wrong')
  })

  it('refuses before comparing anything when no password is set', () => {
    const check = createPasswordChecker()
    expect(check('', undefined, '198.51.100.1')).toBe('off')
    expect(check('anything', undefined, '198.51.100.1')).toBe('off')
    expect(check('anything', '', '198.51.100.1')).toBe('off')
    // Nothing was counted as a failure, so the address is not locked out afterwards.
    for (let i = 0; i < 20; i++) check('anything', undefined, '198.51.100.1')
    expect(check(PASSWORD, PASSWORD, '198.51.100.1')).toBe('ok')
  })

  it('locks an address out after repeated failures, and only that address', () => {
    const check = createPasswordChecker()
    const now = 1_000_000
    for (let i = 0; i < 8; i++) expect(check('wrong', PASSWORD, '198.51.100.2', now)).toBe('wrong')
    expect(check(PASSWORD, PASSWORD, '198.51.100.2', now)).toBe('locked')
    expect(check(PASSWORD, PASSWORD, '198.51.100.3', now)).toBe('ok')
    // Ten minutes later it may try again.
    expect(check(PASSWORD, PASSWORD, '198.51.100.2', now + 10 * 60 * 1000)).toBe('ok')
  })
})
