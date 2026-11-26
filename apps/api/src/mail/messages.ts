import type { MailMessage } from './mailer.js'

/**
 * The account emails. Plain on purpose: text, one link or one code, no images and nothing that
 * tracks whether a message was opened.
 *
 * Nothing a visitor typed goes into a message. A message is sent to whatever address was entered
 * in a public form, so a name or any other free text would let anyone put their own words in an
 * email from this server to a stranger.
 */
export type MailContent = Omit<MailMessage, 'to'>

const APP = 'AppHQ'

/** The sign-in methods a message can name. */
const PROVIDER_NAMES: Record<string, string> = { google: 'Google', github: 'GitHub' }

/** "Google", "Google or GitHub"; empty for an account whose methods this server can't name. */
export function providerList(providerIds: string[]): string {
  const names = providerIds.map((id) => PROVIDER_NAMES[id]).filter((name): name is string => name !== undefined)
  return [...new Set(names)].join(' or ')
}

/** The code that finishes a sign-up. */
export function signUpCodeMessage(input: { code: string; minutes: number }): MailContent {
  return compose({
    subject: `${input.code} is your ${APP} code`,
    blocks: [
      { text: `Your ${APP} confirmation code is:` },
      { code: input.code },
      { text: `Enter it on the sign-up page to finish creating your account. It works for ${input.minutes} minutes.` },
      { text: `If you didn't try to sign up, ignore this email. No account is created without the code.` },
    ],
  })
}

/** Sent instead of a code when the address already has an account, so its owner is not left waiting. */
export function existingAccountMessage(input: { loginUrl: string; forgotUrl: string; hasPassword: boolean; providers: string }): MailContent {
  return compose({
    subject: `You already have an ${APP} account`,
    blocks: [
      { text: `Someone tried to create an ${APP} account with this address, but it already has one.` },
      { text: 'If that was you, sign in instead:' },
      { link: input.loginUrl },
      input.hasPassword
        ? { text: 'If you forgot your password, choose a new one here:' }
        : { text: input.providers ? `This account signs in with ${input.providers}, not with a password.` : 'This account does not sign in with a password.' },
      ...(input.hasPassword ? [{ link: input.forgotUrl }] : []),
      { text: `If it wasn't you, ignore this email. Nothing has changed.` },
    ],
  })
}

/** The link that lets the owner of the address choose a new password. */
export function resetPasswordMessage(input: { url: string; minutes: number }): MailContent {
  return compose({
    subject: `Reset your ${APP} password`,
    blocks: [
      { text: `Someone asked to reset the password of the ${APP} account with this address. If that was you, choose a new password here:` },
      { link: input.url },
      { text: `The link works once, for ${input.minutes} minutes.` },
      { text: `If it wasn't you, ignore this email. Your password stays as it is.` },
    ],
  })
}

/** Sent instead of a reset link to an account that has no password to reset. */
export function noPasswordMessage(input: { loginUrl: string; providers: string }): MailContent {
  return compose({
    subject: `Your ${APP} account has no password`,
    blocks: [
      { text: `Someone asked to reset the password of the ${APP} account with this address.` },
      { text: input.providers ? `This account has no password: it signs in with ${input.providers}. Sign in here:` : 'This account has no password. Sign in here:' },
      { link: input.loginUrl },
      { text: `If it wasn't you, ignore this email. Nothing has changed.` },
    ],
  })
}

/** Tells the owner that the password changed, in case it was not them. */
export function passwordChangedMessage(input: { forgotUrl: string }): MailContent {
  return compose({
    subject: `Your ${APP} password was changed`,
    blocks: [
      { text: `The password of your ${APP} account was just changed, and the account was signed out everywhere.` },
      { text: `If that was you, there is nothing to do. If it wasn't, choose a new password now:` },
      { link: input.forgotUrl },
    ],
  })
}

type Block = { text: string } | { code: string } | { link: string }

/** The same blocks as plain text and as the least HTML that shows them well. */
function compose(input: { subject: string; blocks: Block[] }): MailContent {
  const text = input.blocks.map((block) => ('text' in block ? block.text : 'code' in block ? block.code : block.link)).join('\n\n')
  const html = input.blocks
    .map((block) => {
      if ('text' in block) return `<p>${escapeHtml(block.text)}</p>`
      if ('code' in block) return `<p style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:28px;letter-spacing:4px;margin:24px 0">${escapeHtml(block.code)}</p>`
      return `<p><a href="${escapeHtml(block.link)}">${escapeHtml(block.link)}</a></p>`
    })
    .join('\n')
  return {
    subject: input.subject,
    text: `${text}\n`,
    html: `<!doctype html>\n<html lang="en">\n<body style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:16px;line-height:1.5;color:#111">\n${html}\n</body>\n</html>\n`,
  }
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
