import { redirect } from '@tanstack/react-router'
import { createMiddleware, createServerFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'
import { z } from 'zod'
import { hasDashboardAccess } from '@/server/access'
import { dashboardApi } from '@/server/api'
import { checkPassword } from '@/server/password'
import { getAppSession } from '@/server/session'

/**
 * The data boundary. Route guards only decide what to show; every server function that returns
 * private data uses this middleware, so calling it directly without dashboard access gets
 * nothing. It hands the handler the only client that can call dashboard procedures, as
 * `context.api`. Signing in with an account (Google or GitHub) does not pass it.
 */
export const requireDashboardAccess = createMiddleware({ type: 'function' }).server(async ({ next }) => {
  const api = await dashboardApi()
  if (!api) throw redirect({ to: '/login' })
  return next({ context: { api } })
})

/**
 * Whether the visitor may use the dashboard, and how they left the sidebar: shadcn/ui's sidebar
 * keeps that in a cookie, and reading it here lets the server draw the page the way they left it.
 */
export const getSessionFn = createServerFn({ method: 'GET' }).handler(async () => ({
  dashboardAccess: await hasDashboardAccess(),
  sidebarOpen: getCookie('sidebar_state') !== 'false',
}))

export const signInFn = createServerFn({ method: 'POST' })
  .validator(z.object({ password: z.string().min(1).max(200) }))
  .handler(async ({ data }) => {
    const result = checkPassword(data.password)
    if (result !== 'ok') return { result }

    const session = await getAppSession()
    session.signedIn = true
    await session.save()
    return { result }
  })

export const signOutFn = createServerFn({ method: 'POST' }).handler(async () => {
  const session = await getAppSession()
  session.destroy()
})
