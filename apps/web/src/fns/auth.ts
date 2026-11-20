import { redirect } from '@tanstack/react-router'
import { createMiddleware, createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { checkPassword } from '../server/password'
import { getAppSession } from '../server/session'

/**
 * The data boundary. Route guards only decide what to show; every server function that returns
 * private data uses this middleware, so calling it directly without a session gets nothing.
 */
export const requireSession = createMiddleware({ type: 'function' }).server(async ({ next }) => {
  const session = await getAppSession()
  if (!session.signedIn) throw redirect({ to: '/login' })
  return next()
})

export const getSessionFn = createServerFn({ method: 'GET' }).handler(async () => {
  const session = await getAppSession()
  return { signedIn: session.signedIn === true }
})

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
