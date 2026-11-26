import { createFileRoute } from '@tanstack/react-router'
import { authCookies, CLIENT_ADDRESS_HEADER, visitorAddress } from '@/server/accounts'
import { serverEnv } from '@/server/env'

/**
 * Account sign-in, served on this dashboard's own address so its cookie is first-party. Requests
 * are forwarded to the API, where Better Auth runs; only the API reaches the database.
 *
 * Only these paths are forwarded, matched exactly, so no crafted path can reach anything else on
 * the API with this server's internal token. The API keeps the same list.
 */
const PATHS = new Set(['sign-in/social', 'callback/google', 'callback/github', 'sign-out'])

/** What the browser sent that Better Auth needs; never the dashboard's own session cookie. */
const FORWARDED = ['content-type', 'origin', 'referer', 'user-agent', 'accept', 'accept-language', 'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest']

async function forward({ request, params }: { request: Request; params: { _splat?: string } }) {
  const path = params._splat ?? ''
  if (!PATHS.has(path) || (request.method === 'GET') !== path.startsWith('callback/')) {
    return new Response('Not found', { status: 404 })
  }

  const env = serverEnv()
  const target = `${env.API_URL}/api/auth/${path}${new URL(request.url).search}`

  const headers = new Headers({ authorization: `Bearer ${env.INTERNAL_API_TOKEN}` })
  for (const name of FORWARDED) {
    const value = request.headers.get(name)
    if (value) headers.set(name, value)
  }
  const cookie = authCookies(request.headers.get('cookie') ?? undefined)
  if (cookie) headers.set('cookie', cookie)
  const address = visitorAddress()
  if (address) headers.set(CLIENT_ADDRESS_HEADER, address)

  try {
    const response = await fetch(target, {
      method: request.method,
      headers,
      body: request.method === 'POST' ? await request.arrayBuffer() : undefined,
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    })
    const out = new Headers({ 'cache-control': 'no-store' })
    for (const name of ['content-type', 'location']) {
      const value = response.headers.get(name)
      if (value) out.set(name, value)
    }
    for (const line of response.headers.getSetCookie()) out.append('set-cookie', line)
    return new Response(response.body, { status: response.status, headers: out })
  } catch {
    return new Response('Sign-in is unavailable. Try again in a minute.', { status: 502 })
  }
}

export const Route = createFileRoute('/api/auth/$')({
  server: { handlers: { GET: forward, POST: forward } },
})
