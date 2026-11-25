import { createHash } from 'node:crypto'

/** What an organization made for an account is called. Neutral: nothing from the account. */
export const AUTO_ORGANIZATION_NAME = 'Organization'

/**
 * The slug of the organization made for an account: generated from the account's id, so making it
 * twice (two requests at once) collides on the unique slug instead of making a second one, and
 * `add-owner` can tell it apart. It reveals nothing about the person.
 *
 * The README's SQL computes the same value: 'org-' || left(encode(sha256(id::text::bytea), 'hex'), 12).
 */
export function autoOrganizationSlug(userId: string): string {
  return `org-${createHash('sha256').update(userId).digest('hex').slice(0, 12)}`
}
