import { redirect } from '@tanstack/react-router'
import { createMiddleware, createServerFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'
import { z } from 'zod'
import { TRPCClientError } from '@trpc/client'
import { dashboardAccess } from '@/server/access'
import { ACCESS_HEADER, DASHBOARD_ACCESS, apiClient } from '@/server/api-client'
import { dashboardApi } from '@/server/api'
import { serverEnv } from '@/server/env'
import { checkPassword, passwordEnabled } from '@/server/password'
import { passwordFingerprint } from '@/server/password-session'
import { getAppSession } from '@/server/session'

/**
 * The data boundary. Route guards only decide what to show; every server function that returns
 * private data uses this middleware, so calling it directly without dashboard access gets
 * nothing. It hands the handler the only client that can call dashboard procedures, as
 * `context.api`. A password session or a member account passes it (see
 * server/access.ts).
 */
export const requireDashboardAccess = createMiddleware({ type: 'function' }).server(async ({ next }) => {
  const api = await dashboardApi()
  if (!api) throw redirect({ to: '/login' })
  return next({ context: { api } })
})

/**
 * Whether the visitor may use the dashboard and in which organization, whether this server has a
 * dashboard password at all, and how they left the sidebar: shadcn/ui's sidebar keeps that in a
 * cookie, and reading it here lets the server draw the page the way they left it.
 */
export const getSessionFn = createServerFn({ method: 'GET' }).handler(async () => {
  const access = await dashboardAccess()
  return {
    dashboardAccess: access !== null,
    organization: access?.organization ?? null,
    passwordEnabled: passwordEnabled(),
    sidebarOpen: getCookie('sidebar_state') !== 'false',
  }
})

export const signInFn = createServerFn({ method: 'POST' })
  .validator(z.object({ password: z.string().min(1).max(200) }))
  .handler(async ({ data }) => {
    // Refuses before comparing anything when no password is set here.
    const result = checkPassword(data.password)
    if (result !== 'ok') return { result }

    // The API has its own switch (ALLOW_DASHBOARD_PASSWORD). When it refuses password sessions,
    // say the password is off rather than sign in to a dashboard that would show nothing.
    const refused = await apiClient({ [ACCESS_HEADER]: DASHBOARD_ACCESS })
      .organization.current.query()
      .then(() => false)
      .catch((err: unknown) => err instanceof TRPCClientError && (err.data as { code?: string } | undefined)?.code === 'FORBIDDEN')
    if (refused) return { result: 'off' as const }

    const env = serverEnv()
    const session = await getAppSession()
    session.password = passwordFingerprint(env.DASHBOARD_PASSWORD!, env.SESSION_SECRET)
    await session.save()
    return { result }
  })

/** Ends the password session. The account session ends at /api/auth/sign-out, from the browser. */
export const signOutFn = createServerFn({ method: 'POST' }).handler(async () => {
  const session = await getAppSession()
  session.destroy()
})
