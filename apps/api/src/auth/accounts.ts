import { AUTO_ORGANIZATION_NAME, autoOrganizationSlug } from '../organizations/auto.js'
import { MEMBER_ROLES, providersOf, type Auth, type AuthConfig, type MemberRole, type SocialProvider } from './auth.js'
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

/** A signed-in account's session: who it is, and the organization it last worked in. */
export interface AccountSession {
  user: AccountUser
  sessionId: string
  /** The organization plugin's session field. Only the API sets it (see `trpc/init.ts`). */
  activeOrganizationId: string | null
}

/**
 * Accounts as the tRPC procedures use them; null in the context when accounts are off. These
 * only read and write; what they mean for access is decided in `trpc/init.ts`.
 */
export interface Accounts {
  providers: SocialProvider[]
  /** Whether people can sign up and sign in with an email address and a password. */
  email: boolean
  /** The session behind these cookies, or null. Reading never changes the session. */
  sessionFor(cookieHeader: string | undefined): Promise<AccountSession | null>
  /** The organizations the user belongs to, oldest membership first. */
  membershipsOf(userId: string): Promise<string[]>
  /** Records the organization a session works in. Never reachable over HTTP. */
  setActiveOrganization(sessionId: string, organizationId: string): Promise<void>
  /**
   * Records that the user asked for access. Only an account with no status changes, so asking
   * twice keeps the first date and an approval is never undone.
   */
  requestAccess(userId: string): Promise<AccountUser | null>
  /**
   * Gives an approved account an organization of its own, with the account as its owner, unless
   * it already belongs to one. Safe to call again and from two requests at once. The account
   * then opens the dashboard in that organization.
   */
  ensureOrganization(userId: string): Promise<{ organizationId: string; created: boolean }>
  /**
   * Who belongs to the organization and the invitations to it that still work. Reads only; the
   * `members` procedures decide who may see it.
   */
  membersOf(organizationId: string): Promise<{ members: MemberView[]; invitations: InvitationView[] }>
  /**
   * The member changes, each made by the plugin's own endpoint as the account behind `cookie`,
   * so its rules decide who may do what (see `organizationPlugin`). Each is held to
   * `organizationId`, the organization the request works in; an id from another one is not found.
   * They throw Better Auth's `APIError` when the plugin refuses.
   */
  invite(cookie: string | undefined, organizationId: string, input: { email: string; role: MemberRole }): Promise<InvitationView>
  cancelInvitation(cookie: string | undefined, organizationId: string, invitationId: string): Promise<boolean>
  removeMember(cookie: string | undefined, organizationId: string, memberId: string): Promise<void>
  setRole(cookie: string | undefined, organizationId: string, memberId: string, role: MemberRole): Promise<void>
  /**
   * Accepts every invitation that still works to the session's address, verified, as the
   * plugin does for one; returns how many. The session then works in the last one joined.
   */
  joinInvitedOrganizations(cookie: string | undefined, user: AccountUser): Promise<number>
}

/** A member as the Members page shows them. */
export interface MemberView {
  id: string
  userId: string
  name: string
  email: string
  role: MemberRole
  joinedAt: Date
}

/** An invitation that still works. */
export interface InvitationView {
  id: string
  email: string
  role: MemberRole
  invitedAt: Date
  expiresAt: Date
}

/**
 * The plugin keeps roles as a list in one string ("admin,owner"); a member here has one, the
 * highest named. Anything else counts as a member, the least.
 */
export function roleOf(value: unknown): MemberRole {
  const named = String(value ?? '')
    .split(',')
    .map((role) => role.trim())
  return MEMBER_ROLES.find((role) => named.includes(role)) ?? 'member'
}

const toDate = (value: unknown) => (value instanceof Date ? value : new Date(String(value)))

function toInvitation(row: Record<string, unknown>): InvitationView {
  return {
    id: String(row.id),
    email: String(row.email),
    role: roleOf(row.role),
    invitedAt: toDate(row.createdAt),
    expiresAt: toDate(row.expiresAt),
  }
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
  /** What the plugin's endpoints read the session from: Better Auth's cookies and nothing else. */
  const as = (cookie: string | undefined) => new Headers({ cookie: authCookies(cookie) ?? '' })

  const pendingInvitations = async (where: { field: string; value: string }[]) => {
    const { adapter } = await auth.$context
    const rows = await adapter.findMany<Record<string, unknown>>({
      model: 'invitation',
      where: [...where, { field: 'status', value: 'pending' }],
      sortBy: { field: 'createdAt', direction: 'asc' },
    })
    const now = Date.now()
    return rows.map(toInvitation).filter((row) => row.expiresAt.getTime() > now)
  }

  return {
    providers: providersOf(config),
    email: config.mail !== undefined,

    async sessionFor(cookieHeader) {
      const cookie = authCookies(cookieHeader)
      if (!cookie) return null
      const result = await auth.api.getSession({
        headers: new Headers({ cookie }),
        query: { disableRefresh: true },
      })
      if (!result) return null
      const active = (result.session as { activeOrganizationId?: unknown }).activeOrganizationId
      return {
        user: toUser(result.user),
        sessionId: result.session.id,
        activeOrganizationId: typeof active === 'string' && active.length > 0 ? active : null,
      }
    },

    async membershipsOf(userId) {
      const { adapter } = await auth.$context
      const rows = await adapter.findMany<{ organizationId: string }>({
        model: 'member',
        where: [{ field: 'userId', value: userId }],
        sortBy: { field: 'createdAt', direction: 'asc' },
      })
      return rows.map((row) => row.organizationId)
    },

    async setActiveOrganization(sessionId, organizationId) {
      const { adapter } = await auth.$context
      await adapter.update({
        model: 'session',
        where: [{ field: 'id', value: sessionId }],
        update: { activeOrganizationId: organizationId },
      })
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

    async membersOf(organizationId) {
      const { adapter } = await auth.$context
      const rows = await adapter.findMany<Record<string, unknown>>({
        model: 'member',
        where: [{ field: 'organizationId', value: organizationId }],
        sortBy: { field: 'createdAt', direction: 'asc' },
      })
      const userIds = [...new Set(rows.map((row) => String(row.userId)))]
      const users =
        userIds.length === 0
          ? []
          : await adapter.findMany<{ id: string; name: string; email: string }>({
              model: 'user',
              where: [{ field: 'id', value: userIds, operator: 'in' }],
            })
      const byId = new Map(users.map((found) => [found.id, found]))
      const members = rows.flatMap((row): MemberView[] => {
        const found = byId.get(String(row.userId))
        if (!found) return []
        return [
          {
            id: String(row.id),
            userId: found.id,
            name: found.name,
            email: found.email,
            role: roleOf(row.role),
            joinedAt: toDate(row.createdAt),
          },
        ]
      })
      return { members, invitations: await pendingInvitations([{ field: 'organizationId', value: organizationId }]) }
    },

    async invite(cookie, organizationId, input) {
      const created = await auth.api.createInvitation({
        headers: as(cookie),
        body: { email: input.email, role: input.role, organizationId },
      })
      return toInvitation(created as unknown as Record<string, unknown>)
    },

    async cancelInvitation(cookie, organizationId, invitationId) {
      // The plugin cancels an invitation in whichever organization it belongs to, so it is
      // looked up here first: one of another organization is not found from this one.
      const [open] = (await pendingInvitations([
        { field: 'id', value: invitationId },
        { field: 'organizationId', value: organizationId },
      ]))
      if (!open) return false
      await auth.api.cancelInvitation({ headers: as(cookie), body: { invitationId } })
      return true
    },

    async removeMember(cookie, organizationId, memberId) {
      await auth.api.removeMember({ headers: as(cookie), body: { memberIdOrEmail: memberId, organizationId } })
    },

    async setRole(cookie, organizationId, memberId, role) {
      await auth.api.updateMemberRole({ headers: as(cookie), body: { memberId, role, organizationId } })
    },

    async joinInvitedOrganizations(cookie, user) {
      if (!user.emailVerified) return 0
      const invitations = await pendingInvitations([{ field: 'email', value: user.email.toLowerCase() }])
      let joined = 0
      for (const invitation of invitations) {
        try {
          await auth.api.acceptInvitation({ headers: as(cookie), body: { invitationId: invitation.id } })
          joined += 1
        } catch {
          // Already a member, or the invitation ended a moment ago: nothing to join.
        }
      }
      return joined
    },
  }
}
