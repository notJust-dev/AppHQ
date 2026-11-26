import { describe, expect, it } from 'vitest'
import { loadEnv } from '../env.js'
import { startMailCatcher } from '../test/smtp.js'
import { mailConfigFromEnv } from './config.js'
import { createSmtpMailer, type Mailer, type MailMessage } from './mailer.js'
import {
  existingAccountMessage,
  noPasswordMessage,
  passwordChangedMessage,
  providerList,
  resetPasswordMessage,
  signUpCodeMessage,
} from './messages.js'
import { createOutbox } from './outbox.js'

const base = {
  INTERNAL_API_TOKEN: 'x'.repeat(32),
  DATABASE_URL: 'postgres://u:p@127.0.0.1/db',
  BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters',
  PUBLIC_URL: 'https://apphq.example.com',
}
const mail = { SMTP_HOST: 'smtp.example.com', MAIL_FROM: 'AppHQ <no-reply@apphq.example.com>' }

describe('the mail server from the environment', () => {
  it('is absent unless it is set', () => {
    expect(mailConfigFromEnv(loadEnv(base))).toBeNull()
    expect(mailConfigFromEnv(loadEnv({ ...base, SMTP_HOST: '', MAIL_FROM: '' }))).toBeNull()
  })

  it('uses port 465 with TLS from the start unless told otherwise', () => {
    expect(mailConfigFromEnv(loadEnv({ ...base, ...mail }))).toEqual({
      host: 'smtp.example.com',
      port: 465,
      tls: 'implicit',
      user: undefined,
      password: undefined,
      from: 'AppHQ <no-reply@apphq.example.com>',
      replyTo: undefined,
    })
  })

  it.each([
    [{ SMTP_PORT: '587' }, { port: 587, tls: 'starttls' }],
    [{ SMTP_PORT: '2525' }, { port: 2525, tls: 'starttls' }],
    [{ SMTP_TLS: 'starttls' }, { port: 587, tls: 'starttls' }],
    [{ SMTP_PORT: '2465', SMTP_TLS: 'implicit' }, { port: 2465, tls: 'implicit' }],
    [{ SMTP_HOST: '127.0.0.1', SMTP_TLS: 'none' }, { port: 1025, tls: 'none' }],
    [{ SMTP_HOST: 'localhost', SMTP_PORT: '2500', SMTP_TLS: 'none' }, { port: 2500, tls: 'none' }],
  ])('works out the port and the protection from %j', (vars, expected) => {
    expect(mailConfigFromEnv(loadEnv({ ...base, ...mail, ...vars }))).toMatchObject(expected)
  })

  it('takes a user, a password and a reply address', () => {
    const config = mailConfigFromEnv(
      loadEnv({ ...base, ...mail, SMTP_USER: 'test-smtp-user', SMTP_PASSWORD: 'test-smtp-password', MAIL_REPLY_TO: 'help@apphq.example.com' }),
    )
    expect(config).toMatchObject({ user: 'test-smtp-user', password: 'test-smtp-password', replyTo: 'help@apphq.example.com' })
  })

  it.each([
    [{ ...mail, SMTP_TLS: 'none' }, /SMTP_TLS/],
    [{ ...mail, SMTP_TLS: 'ssl' }, /SMTP_TLS/],
    [{ ...mail, SMTP_PORT: '0' }, /SMTP_PORT/],
    [{ ...mail, SMTP_USER: 'test-smtp-user' }, /SMTP_PASSWORD/],
    [{ ...mail, MAIL_FROM: 'not an address' }, /MAIL_FROM/],
    [{ ...mail, MAIL_FROM: 'AppHQ <no-reply@apphq>' }, /MAIL_FROM/],
    [{ ...mail, MAIL_REPLY_TO: 'nobody' }, /MAIL_REPLY_TO/],
    [{ SMTP_PORT: '587' }, /SMTP_HOST/],
    [{ SMTP_USER: 'test-smtp-user', SMTP_PASSWORD: 'test-smtp-password' }, /SMTP_HOST/],
  ])('rejects a wrong or half-set mail server: %j', (vars, message) => {
    expect(() => loadEnv({ ...base, ...vars })).toThrow(message)
  })
})

describe('the account emails', () => {
  const everyMessage = [
    signUpCodeMessage({ code: '048213', minutes: 10 }),
    existingAccountMessage({ loginUrl: 'https://apphq.example.com/login', forgotUrl: 'https://apphq.example.com/forgot-password', hasPassword: true, providers: '' }),
    existingAccountMessage({ loginUrl: 'https://apphq.example.com/login', forgotUrl: 'https://apphq.example.com/forgot-password', hasPassword: false, providers: 'Google' }),
    resetPasswordMessage({ url: 'https://apphq.example.com/reset-password#token=test-token', minutes: 60 }),
    noPasswordMessage({ loginUrl: 'https://apphq.example.com/login', providers: 'Google or GitHub' }),
    passwordChangedMessage({ forgotUrl: 'https://apphq.example.com/forgot-password' }),
  ]

  it('carry the code on a line of its own, in both bodies and the subject', () => {
    const message = signUpCodeMessage({ code: '048213', minutes: 10 })
    expect(message.subject).toBe('048213 is your AppHQ code')
    expect(message.text).toMatch(/^048213$/m)
    expect(message.text).toContain('10 minutes')
    expect(message.html).toContain('>048213</p>')
  })

  it('carry the reset link whole, in both bodies', () => {
    const url = 'https://apphq.example.com/reset-password#token=test-token'
    const message = resetPasswordMessage({ url, minutes: 60 })
    expect(message.text).toContain(`\n${url}\n`)
    expect(message.html).toContain(`<a href="${url}">${url}</a>`)
  })

  it('offer a reset only to an account that has a password', () => {
    const [, withPassword, withGoogle] = everyMessage
    expect(withPassword!.text).toContain('/forgot-password')
    expect(withGoogle!.text).not.toContain('/forgot-password')
    expect(withGoogle!.text).toContain('signs in with Google, not with a password')
  })

  it('have no images, scripts, styles sheets or anything that tracks an open', () => {
    for (const message of everyMessage) {
      expect(message.html).not.toMatch(/<img|<script|<link|<style|<iframe|background=|url\(/i)
      expect(message.text.endsWith('\n')).toBe(true)
      expect(message.subject).toContain('AppHQ')
    }
  })

  it('escape what goes into the HTML body', () => {
    const message = resetPasswordMessage({ url: 'https://apphq.example.com/reset-password#token=a"><b>&', minutes: 60 })
    expect(message.html).not.toContain('"><b>')
    expect(message.html).toContain('&quot;&gt;&lt;b&gt;&amp;')
  })

  it('name the sign-in methods they know', () => {
    expect(providerList(['google'])).toBe('Google')
    expect(providerList(['github', 'google', 'google'])).toBe('GitHub or Google')
    expect(providerList(['credential', 'something-else'])).toBe('')
  })
})

describe('the outbox', () => {
  const message = (to: string): MailMessage => ({ to, subject: 'A test', text: 'Text\n', html: '<p>Text</p>' })
  const recording = () => {
    const lines: string[] = []
    return { lines, log: { info: (line: string) => lines.push(line), warn: (line: string) => lines.push(line), error: (line: string) => lines.push(line) } }
  }
  const settle = () => new Promise((resolve) => setImmediate(resolve))

  it('sends up to the limit to one address in a window, then again once the window has passed', async () => {
    const sent: MailMessage[] = []
    let now = 1_000_000
    const outbox = createOutbox({ send: async (m) => void sent.push(m) }, recording().log, { max: 2, windowMs: 60_000 }, () => now)

    expect(outbox.send('sign-up code', message('one@example.com'))).toBe(true)
    expect(outbox.send('sign-up code', message('ONE@example.com '))).toBe(true)
    expect(outbox.hasRoom('one@example.com')).toBe(false)
    expect(outbox.send('sign-up code', message('one@example.com'))).toBe(false)
    // Another address is not affected.
    expect(outbox.send('sign-up code', message('two@example.com'))).toBe(true)

    now += 60_001
    expect(outbox.hasRoom('one@example.com')).toBe(true)
    expect(outbox.send('sign-up code', message('one@example.com'))).toBe(true)
    await settle()
    expect(sent.map((m) => m.to.trim().toLowerCase())).toEqual(['one@example.com', 'one@example.com', 'two@example.com', 'one@example.com'])
  })

  it('never throws and never waits when the mail server fails, and logs no address', async () => {
    const { lines, log } = recording()
    const failing: Mailer = {
      send: async () => {
        throw Object.assign(new Error('550 mailbox private@example.com unavailable'), { code: 'EENVELOPE', responseCode: 550 })
      },
    }
    const outbox = createOutbox(failing, log)
    expect(outbox.send('password reset link', message('private@example.com'))).toBe(true)
    await settle()
    expect(lines).toEqual(['mail: could not send a password reset link: EENVELOPE, SMTP 550'])

    const throwing: Mailer = {
      send: () => {
        throw new Error('private@example.com')
      },
    }
    expect(createOutbox(throwing, log).send('sign-up code', message('private@example.com'))).toBe(true)
    await settle()
    expect(lines.join('\n')).not.toContain('private@example.com')
  })

  it('logs a refusal without the address', () => {
    const { lines, log } = recording()
    const outbox = createOutbox({ send: async () => {} }, log, { max: 1, windowMs: 60_000 })
    outbox.send('sign-up code', message('private@example.com'))
    outbox.send('sign-up code', message('private@example.com'))
    expect(lines).toHaveLength(1)
    expect(lines[0]).not.toContain('private@example.com')
  })
})

describe('sending over SMTP', () => {
  it('delivers one message to one address, with both bodies and the sender as set', async () => {
    const catcher = await startMailCatcher()
    try {
      const mailer = createSmtpMailer({
        host: '127.0.0.1',
        port: catcher.port,
        tls: 'none',
        from: 'AppHQ <no-reply@apphq.example.com>',
        replyTo: 'help@apphq.example.com',
      })
      await mailer.send({ to: 'person@example.com', ...signUpCodeMessage({ code: '048213', minutes: 10 }) })

      expect(catcher.caught).toHaveLength(1)
      const [caught] = catcher.caught
      expect(caught!.from).toBe('no-reply@apphq.example.com')
      expect(caught!.to).toEqual(['person@example.com'])
      expect(caught!.data).toMatch(/^From: AppHQ <no-reply@apphq\.example\.com>$/m)
      expect(caught!.data).toMatch(/^To: person@example\.com$/m)
      expect(caught!.data).toMatch(/^Reply-To: help@apphq\.example\.com$/m)
      expect(caught!.data).toMatch(/^Subject: 048213 is your AppHQ code$/m)
      expect(caught!.data).toMatch(/Content-Type: text\/plain/)
      expect(caught!.data).toMatch(/Content-Type: text\/html/)
      expect(caught!.data).toContain('048213')
    } finally {
      await catcher.close()
    }
  })

  it('rejects, rather than hangs, when the mail server is not there', async () => {
    const catcher = await startMailCatcher()
    const { port } = catcher
    await catcher.close()
    const mailer = createSmtpMailer({ host: '127.0.0.1', port, tls: 'none', from: 'no-reply@apphq.example.com' })
    await expect(mailer.send({ to: 'person@example.com', subject: 'A test', text: 'Text\n', html: '<p>Text</p>' })).rejects.toThrow()
  })

  it('does not send in the clear to a server that offers no TLS when TLS is required', async () => {
    const catcher = await startMailCatcher()
    try {
      const mailer = createSmtpMailer({ host: '127.0.0.1', port: catcher.port, tls: 'starttls', from: 'no-reply@apphq.example.com' })
      await expect(mailer.send({ to: 'person@example.com', subject: 'A test', text: 'Text\n', html: '<p>Text</p>' })).rejects.toThrow()
      expect(catcher.caught).toHaveLength(0)
    } finally {
      await catcher.close()
    }
  })
})
