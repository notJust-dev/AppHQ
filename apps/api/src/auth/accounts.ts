import { AUTO_ORGANIZATION_NAME, autoOrganizationSlug } from '../organizations/auto.js'
import { providersOf, type Auth, type AuthConfig, type SocialProvider } from './auth.js'
import { authCookies } from './routes.js'

export type AccessStatus = 'requested' | 'approved'

/** What the API knows about the person behind a request's account cookie. */
export interface AccountUser {
  id: string
  email: string
  name: string
  emailVerified: boolean
  accessStatus: AccessStatus | null
  accessRequestedAt: Date | null
}

/** Accounts as the tRPC procedures use them; null in the context when accounts are off. */
export interface Accounts {
  providers: SocialProvider[]
  /** The signed-in user behind these cookies, or null. Reading never changes the session. */
  userFor(cookieHeader: string | undefined): Promise<AccountUser | null>
  /**
   * Records that the user asked for access. Only an account with no status changes, so asking
   * twice keeps the first date and an approval is never undone.
   */
  requestAccess(userId: string): Promise<AccountUser | null>
  /**
   * Gives an approved account an organization of its own, with the account as its owner, unless
   * it already belongs to one. Safe to call again and from two requests at once. Membership
   * grants nothing yet: the dashboard still takes the dashboard password.
   */
  ensureOrganization(userId: string): Promise<{ organizationId: string; created: boolean }>
}

function toAccessStatus(value: unknown): AccessStatus | null {
  return value === 'requested' || value === 'approved' ? value : null
}

function toUser(user: Record<string, unknown> & { id: string; email: string; name: string; emailVerified: boolean }): AccountUser {
  const requestedAt = user.accessRequestedAt
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    emailVerified: user.emailVerified,
    accessStatus: toAccessStatus(user.accessStatus),
    accessRequestedAt: requestedAt instanceof Date ? requestedAt : requestedAt ? new Date(String(requestedAt)) : null,
  }
}

export function createAccounts(auth: Auth, config: AuthConfig): Accounts {
  return {
    providers: providersOf(config),

    async userFor(cookieHeader) {
      const cookie = authCookies(cookieHeader)
      if (!cookie) return null
      const result = await auth.api.getSession({
        headers: new Headers({ cookie }),
        query: { disableRefresh: true },
      })
      return result ? toUser(result.user) : null
    },

    async requestAccess(userId) {
      const context = await auth.$context
      // One conditional write: it only matches while the status is still empty.
      await context.adapter.update({
        model: 'user',
        where: [
          { field: 'id', value: userId },
          { field: 'accessStatus', value: null },
        ],
        update: { accessStatus: 'requested', accessRequestedAt: new Date() },
      })
      const user = await context.internalAdapter.findUserById(userId)
      return user ? toUser(user) : null
    },

    async ensureOrganization(userId) {
      const { adapter } = await auth.$context
      const membershipOf = () =>
        adapter.findMany<{ organizationId: string }>({ model: 'member', where: [{ field: 'userId', value: userId }], limit: 1 })
      const [existing] = await membershipOf()
      if (existing) return { organizationId: existing.organizationId, created: false }

      // The slug comes from the account's id, so a second request at the same moment finds the
      // first one's organization (or fails on the unique slug) instead of making another.
      const slug = autoOrganizationSlug(userId)
      const bySlug = () =>
        adapter.findOne<{ id: string }>({ model: 'organization', where: [{ field: 'slug', value: slug }] })
      let organization = await bySlug()
      if (!organization) {
        try {
          organization = await adapter.create<Record<string, unknown>, { id: string }>({
            model: 'organization',
            data: { name: AUTO_ORGANIZATION_NAME, slug, createdAt: new Date() },
          })
        } catch (err) {
          organization = await bySlug()
          if (!organization) throw err
        }
      }
      try {
        await adapter.create({
          model: 'member',
          data: { organizationId: organization.id, userId, role: 'owner', createdAt: new Date() },
        })
      } catch (err) {
        // Another request added the same membership first.
        if ((await membershipOf()).length === 0) throw err
      }
      return { organizationId: organization.id, created: true }
    },
  }
}
