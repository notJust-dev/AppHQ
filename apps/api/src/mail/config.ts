import type { Env } from '../env.js'
import type { SmtpConfig, SmtpTls } from './mailer.js'

const DEFAULT_PORTS: Record<SmtpTls, number> = { implicit: 465, starttls: 587, none: 1025 }

/**
 * The mail server from the environment, or null when none is set. `loadEnv` has already checked
 * that the variables belong together. Whichever of the port and the protection is missing
 * follows from the other; with neither, port 465 with TLS from the start.
 */
export function mailConfigFromEnv(env: Env): SmtpConfig | null {
  if (!env.SMTP_HOST || !env.MAIL_FROM) return null
  const tls: SmtpTls = env.SMTP_TLS ?? (env.SMTP_PORT === undefined || env.SMTP_PORT === 465 ? 'implicit' : 'starttls')
  return {
    host: env.SMTP_HOST,
    port: env.SMTP_PORT ?? DEFAULT_PORTS[tls],
    tls,
    user: env.SMTP_USER,
    password: env.SMTP_PASSWORD,
    from: env.MAIL_FROM,
    replyTo: env.MAIL_REPLY_TO,
  }
}
