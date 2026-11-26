import nodemailer from 'nodemailer'

/** One email to one address. Both bodies are always sent; mail programs show the HTML one. */
export interface MailMessage {
  to: string
  subject: string
  text: string
  html: string
}

/** Something that delivers mail. Rejects when the mail server refuses or can't be reached. */
export interface Mailer {
  send(message: MailMessage): Promise<void>
}

/**
 * How the connection to the mail server is protected:
 * - `implicit`: TLS from the first byte (port 465).
 * - `starttls`: upgraded to TLS before anything is sent, or the message is not sent (port 587).
 * - `none`: no encryption. Only for a mail catcher on this machine.
 */
export type SmtpTls = 'implicit' | 'starttls' | 'none'

export interface SmtpConfig {
  host: string
  port: number
  tls: SmtpTls
  user?: string
  password?: string
  /** The sender, as `Name <address>` or a bare address. */
  from: string
  replyTo?: string
}

/**
 * Sends mail through any SMTP server, so the same code works with every mail provider and with a
 * local mail catcher. Nothing connects until the first message is sent.
 */
export function createSmtpMailer(config: SmtpConfig): Mailer {
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.tls === 'implicit',
    requireTLS: config.tls === 'starttls',
    ignoreTLS: config.tls === 'none',
    auth: config.user ? { user: config.user, pass: config.password ?? '' } : undefined,
    // A mail server that hangs must not hold a message forever.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    // Messages are built from text only; nothing is ever read from disk or fetched.
    disableFileAccess: true,
    disableUrlAccess: true,
  })

  return {
    async send(message) {
      await transport.sendMail({
        from: config.from,
        replyTo: config.replyTo,
        // As an object, so the address is one recipient whatever characters it holds.
        to: { name: '', address: message.to },
        subject: message.subject,
        text: message.text,
        html: message.html,
      })
    },
  }
}
