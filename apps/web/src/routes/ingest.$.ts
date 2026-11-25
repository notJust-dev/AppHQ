import { createFileRoute } from '@tanstack/react-router'
import { analyticsConfig, posthogAssetsHost, posthogHost } from '@/server/analytics'

/**
 * A first-party path for PostHog, so ad blockers that block PostHog's own domains don't drop
 * events. It only exists while analytics are on, forwards nothing but the request itself (no
 * cookies, so the dashboard session never leaves this server), and passes on the visitor's
 * address so PostHog can tell the country.
 */
async function forward({ request, params }: { request: Request; params: { _splat?: string } }) {
  if (!analyticsConfig()) return new Response('Not found', { status: 404 })

  const path = params._splat ?? ''
  // Scripts and per-project config come from PostHog's CDN; events and flags from its API.
  const upstream = /^(static|array)\//.test(path) ? posthogAssetsHost() : posthogHost()
  const url = new URL(request.url)
  const target = `${upstream}/${path}${url.search}`

  const headers = new Headers()
  for (const name of ['content-type', 'content-encoding', 'user-agent', 'accept', 'accept-language']) {
    const value = request.headers.get(name)
    if (value) headers.set(name, value)
  }
  // Velocity sits behind Cloudflare, which puts the visitor's address in cf-connecting-ip.
  const visitor = request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0]
  if (visitor) headers.set('x-forwarded-for', visitor.trim())

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD'
  try {
    const response = await fetch(target, {
      method: request.method,
      headers,
      body: hasBody ? await request.arrayBuffer() : undefined,
      signal: AbortSignal.timeout(10_000),
    })
    // fetch has already decompressed the body, so its encoding and length no longer apply.
    const out = new Headers()
    for (const name of ['content-type', 'cache-control']) {
      const value = response.headers.get(name)
      if (value) out.set(name, value)
    }
    return new Response(response.body, { status: response.status, headers: out })
  } catch {
    return new Response('Analytics upstream unavailable', { status: 502 })
  }
}

export const Route = createFileRoute('/ingest/$')({
  server: { handlers: { GET: forward, POST: forward } },
})
