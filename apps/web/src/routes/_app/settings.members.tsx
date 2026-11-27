import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { Info, KeyRound } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Panel } from '@/components/Panel'
import { Private } from '@/components/Private'
import { SettingsPage } from '@/components/SettingsPage'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import {
  MEMBER_ROLES,
  cancelInvitationFn,
  inviteMemberFn,
  listMembersFn,
  removeMemberFn,
  setMemberRoleFn,
  type MemberRole,
} from '@/fns/members'
import { formatDay } from '@/lib/format'
import { membersQuery } from '@/lib/queries'

export const Route = createFileRoute('/_app/settings/members')({
  loader: ({ context }) => context.queryClient.ensureQueryData(membersQuery()),
  head: () => ({ meta: [{ title: 'Members · AppHQ' }] }),
  component: MembersPage,
})

type WithAccounts = Extract<Awaited<ReturnType<typeof listMembersFn>>, { accounts: true }>
type Member = WithAccounts['members'][number]
type Invitation = WithAccounts['invitations'][number]
type You = WithAccounts['you']

const ROLE_LABELS: Record<MemberRole, string> = { owner: 'Owner', admin: 'Admin', member: 'Member' }

/** What each role may do, as Better Auth's organization plugin rules it on the API. */
const ROLE_HINTS: Record<MemberRole, string> = {
  owner: 'Everything, including inviting and removing owners.',
  admin: 'Invites, removes and changes the roles of everyone but owners.',
  member: 'Uses the dashboard: apps, numbers and integrations.',
}

const day = (iso: string) => formatDay(iso.slice(0, 10))

/** The people who can open this organization's dashboard, and the invitations to it. */
function MembersPage() {
  const { data } = useSuspenseQuery(membersQuery())

  return (
    <SettingsPage
      title="Members"
      description="The people who can open this organization’s dashboard. Everyone sees the same apps and numbers; owners and admins also invite and remove people."
    >
      {!data.accounts ? (
        <AccountsOff />
      ) : (
        <>
          {data.via === 'password' && (
            <Alert>
              <KeyRound aria-hidden="true" />
              <AlertTitle>You signed in with the dashboard password</AlertTitle>
              <AlertDescription>
                The password is nobody’s account, so it shows the members but can’t change them. To
                invite people, sign in with your account at /login.
              </AlertDescription>
            </Alert>
          )}
          {data.canManage && <InviteForm you={data.you} mail={data.mail} />}
          <MemberList members={data.members} you={data.you} canManage={data.canManage} />
          {(data.canManage || data.via === 'password') && (
            <InvitationList invitations={data.invitations} you={data.you} canManage={data.canManage} />
          )}
          {data.via === 'account' && !data.canManage && (
            <p className="text-sm text-muted-foreground">Only owners and admins invite and remove people.</p>
          )}
        </>
      )}
    </SettingsPage>
  )
}

/** Members need accounts; with the dashboard password alone there is nobody to invite. */
function AccountsOff() {
  return (
    <Panel title="Members need accounts">
      <div className="flex max-w-prose flex-col gap-3 text-muted-foreground">
        <p>
          This server signs in with the dashboard password only, so there is nobody to invite: the
          password is the same for everyone who knows it.
        </p>
        <p>
          To give people their own sign-in, turn accounts on. Set <code className="text-foreground">BETTER_AUTH_SECRET</code>{' '}
          and <code className="text-foreground">PUBLIC_URL</code> on the API, and at least one way to sign in: Google,
          GitHub, or a mail server for email sign-up. The README’s section “Accounts and access requests” has every
          step. Then make your account an owner of this organization with{' '}
          <code className="text-foreground">npm run cli -- add-owner</code>, and this page lets you invite people.
        </p>
      </div>
    </Panel>
  )
}

/** The roles `you` may give: only an owner gives the owner role. */
function rolesFor(you: You): MemberRole[] {
  return MEMBER_ROLES.filter((role) => role !== 'owner' || you?.role === 'owner')
}

/** Whether `you` may change or remove this member: the plugin's rule, so the buttons match it. */
function mayChange(you: You, canManage: boolean, member: Member) {
  return canManage && you !== null && member.id !== you.memberId && (member.role !== 'owner' || you.role === 'owner')
}

function InviteForm(props: { you: You; mail: boolean }) {
  const invite = useServerFn(inviteMemberFn)
  const queryClient = useQueryClient()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<MemberRole>('member')
  const mutation = useMutation({
    mutationFn: () => invite({ data: { email, role } }),
    onSuccess: async (result) => {
      if (!result.ok) return
      setEmail('')
      toast.success(
        result.mailed
          ? 'Invited. They get an email with a link to sign in, and join when they do.'
          : `Invited. This server sends no email, so ask them to sign in at ${window.location.origin}/login with that address; they join when they do.`,
      )
      await queryClient.invalidateQueries({ queryKey: ['members'] })
    },
  })
  const result = mutation.data
  const problem = mutation.isError
    ? 'Could not reach the dashboard server. Try again.'
    : result && !result.ok
      ? result.message
      : null

  return (
    <Panel title="Invite someone">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          mutation.mutate()
        }}
      >
        <Field data-invalid={problem !== null}>
          <FieldLabel htmlFor="invite-email">Email address</FieldLabel>
          <div className="flex flex-wrap gap-2">
            <Input
              id="invite-email"
              name="invite-email"
              type="email"
              required
              maxLength={254}
              autoComplete="off"
              value={email}
              data-private=""
              onChange={(event) => setEmail(event.target.value)}
              aria-invalid={problem !== null}
              className="min-w-0 flex-1 basis-56"
            />
            <Select value={role} onValueChange={(chosen) => setRole(chosen as MemberRole)}>
              <SelectTrigger aria-label="Role" className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {rolesFor(props.you).map((option) => (
                  <SelectItem key={option} value={option}>
                    {ROLE_LABELS[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && <Spinner />}
              {mutation.isPending ? 'Inviting…' : 'Invite'}
            </Button>
          </div>
          <FieldDescription>
            {ROLE_HINTS[role]}{' '}
            {props.mail
              ? 'They get an email, and join when they sign in or sign up with this address. The invitation works for 7 days.'
              : 'This server sends no email: tell them to sign in or sign up with this address, and they join when they do. The invitation works for 7 days.'}
          </FieldDescription>
          {problem && <FieldError>{problem}</FieldError>}
        </Field>
      </form>
    </Panel>
  )
}

function MemberList(props: { members: Member[]; you: You; canManage: boolean }) {
  return (
    <Panel title="Members" bodyClassName="">
      <ul className="divide-y">
        {props.members.map((member) => (
          <MemberRow key={member.id} member={member} you={props.you} canManage={props.canManage} />
        ))}
      </ul>
    </Panel>
  )
}

function MemberRow(props: { member: Member; you: You; canManage: boolean }) {
  const { member, you } = props
  const setRole = useServerFn(setMemberRoleFn)
  const queryClient = useQueryClient()
  const changeable = mayChange(you, props.canManage, member)
  const mutation = useMutation({
    mutationFn: (role: MemberRole) => setRole({ data: { memberId: member.id, role } }),
    onSuccess: async (result) => {
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      await queryClient.invalidateQueries({ queryKey: ['members'] })
    },
    onError: () => toast.error('Could not reach the dashboard server. Try again.'),
  })
  const isYou = you?.memberId === member.id

  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3">
      <span className="min-w-0 break-words">
        <span className="font-medium">
          <Private>{member.name || member.email}</Private>
        </span>
        {isYou && (
          <Badge variant="secondary" className="ml-2">
            You
          </Badge>
        )}
        <span className="block text-xs text-muted-foreground">
          {member.name && (
            <>
              <Private>{member.email}</Private> ·{' '}
            </>
          )}
          joined {day(member.joinedAt)}
        </span>
      </span>
      <span className="flex items-center gap-2">
        {changeable ? (
          <Select
            value={member.role}
            disabled={mutation.isPending}
            onValueChange={(chosen) => mutation.mutate(chosen as MemberRole)}
          >
            <SelectTrigger aria-label={`Role of ${member.name || member.email}`} className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {rolesFor(you).map((option) => (
                <SelectItem key={option} value={option}>
                  {ROLE_LABELS[option]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span className="text-sm text-muted-foreground">{ROLE_LABELS[member.role]}</span>
        )}
        {changeable && <RemoveMember member={member} />}
      </span>
    </li>
  )
}

function RemoveMember(props: { member: Member }) {
  const remove = useServerFn(removeMemberFn)
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const mutation = useMutation({
    mutationFn: () => remove({ data: { memberId: props.member.id } }),
    onSuccess: async (result) => {
      if (!result.ok) return
      setOpen(false)
      toast.success(
        <span>
          Removed <Private>{props.member.name || props.member.email}</Private>.
        </span>,
      )
      await queryClient.invalidateQueries({ queryKey: ['members'] })
    },
  })
  const result = mutation.data
  const problem = mutation.isError
    ? 'Could not reach the dashboard server. Try again.'
    : result && !result.ok
      ? result.message
      : null
  const who = props.member.name || props.member.email

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!mutation.isPending) setOpen(next)
        if (!next) mutation.reset()
      }}
    >
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={`Remove ${who}`}>
          Remove
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Remove <Private>{who}</Private>?
          </AlertDialogTitle>
          <AlertDialogDescription>
            They can no longer open this organization’s dashboard. Its apps and numbers stay as they are. You can
            invite them again later.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {problem && (
          <p role="alert" className="text-sm text-destructive">
            {problem}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={mutation.isPending}>Cancel</AlertDialogCancel>
          <Button variant="destructive" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending && <Spinner />}
            {mutation.isPending ? 'Removing…' : 'Remove'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function InvitationList(props: { invitations: Invitation[]; you: You; canManage: boolean }) {
  return (
    <Panel title="Invitations" bodyClassName="">
      {props.invitations.length === 0 ? (
        <p className="flex items-center gap-2 px-5 py-4 text-muted-foreground">
          <Info aria-hidden="true" className="size-4 shrink-0" />
          No open invitations.
        </p>
      ) : (
        <ul className="divide-y">
          {props.invitations.map((invitation) => (
            <InvitationRow
              key={invitation.id}
              invitation={invitation}
              // Only an owner cancels an invitation to be an owner; the API lists those to owners only.
              cancellable={props.canManage && (invitation.role !== 'owner' || props.you?.role === 'owner')}
            />
          ))}
        </ul>
      )}
    </Panel>
  )
}

function InvitationRow(props: { invitation: Invitation; cancellable: boolean }) {
  const { invitation } = props
  const cancel = useServerFn(cancelInvitationFn)
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: () => cancel({ data: { invitationId: invitation.id } }),
    onSuccess: async (result) => {
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success('Invitation cancelled.')
      await queryClient.invalidateQueries({ queryKey: ['members'] })
    },
    onError: () => toast.error('Could not reach the dashboard server. Try again.'),
  })

  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3">
      <span className="min-w-0 break-words">
        <Private className="font-medium">{invitation.email}</Private>
        <span className="block text-xs text-muted-foreground">
          {ROLE_LABELS[invitation.role]} · invited {day(invitation.invitedAt)} · works until {day(invitation.expiresAt)}
        </span>
      </span>
      {props.cancellable && (
        <Button
          variant="ghost"
          size="sm"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate()}
          aria-label={`Cancel the invitation to ${invitation.email}`}
        >
          {mutation.isPending && <Spinner />}
          Cancel invitation
        </Button>
      )}
    </li>
  )
}
