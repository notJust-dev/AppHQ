import type { FastifyInstance } from 'fastify'
import { AUTH_PATHS, CLIENT_ADDRESS_HEADER, type Auth } from './auth.js'

const PREFIX = '/api/auth'

/** Request headers Better Auth sees. Not the internal token, and not the Host. */
const FORWARDED = [
  'content-type',
  'origin',
  'referer',
  'user-agent',
  'accept',
  'accept-language',
  'sec-fetch-site',
  'sec-fetch-mode',
  'sec-fetch-dest',
  CLIENT_ADDRESS_HEADER,
]

/** Better Auth's own cookies, and no other. */
export function authCookies(header: string | undefined): string | undefined {
  const kept = (header ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => /^(__Secure-)?better-auth\.[\w.-]+=/.test(part))
  return kept.length > 0 ? kept.join('; ') : undefined
}

/**
 * Better Auth's handler, at /api/auth/* on this API. Register it inside the scope that requires
 * the internal token: only the dashboard server reaches it, forwarding its visitors' requests,
 * so the session cookie stays on the dashboard's own domain.
 *
 * Only the paths in `AUTH_PATHS` are served. The request Better Auth sees is built on the
 * dashboard's public origin, so no header can change the addresses it writes into redirects.
 */
export function authRoutes(auth: Auth, origin: string) {
  return async (scope: FastifyInstance) => {
    // Better Auth reads the body itself; keep it exactly as it was sent, whatever its type.
    scope.removeAllContentTypeParsers()
    scope.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: 16 * 1024 }, (_request, body, done) => {
      done(null, body)
    })

    scope.route({
      method: ['GET', 'POST'],
      url: `${PREFIX}/*`,
      handler: async (request, reply) => {
        const [pathname = '', query] = request.url.split('?', 2)
        const path = pathname.slice(PREFIX.length)
        if (!pathname.startsWith(`${PREFIX}/`) || !AUTH_PATHS.has(path)) {
          return reply.code(404).send({ error: 'not found' })
        }

        const headers = new Headers()
        for (const name of FORWARDED) {
          const value = request.headers[name]
          if (typeof value === 'string') headers.set(name, value)
        }
        const cookie = authCookies(request.headers.cookie)
        if (cookie) headers.set('cookie', cookie)

        const body = request.method === 'POST' && Buffer.isBuffer(request.body) ? new Uint8Array(request.body) : undefined
        const url = new URL(`${PREFIX}${path}${query === undefined ? '' : `?${query}`}`, origin)
        const response = await auth.handler(new Request(url, { method: request.method, headers, body }))

        reply.code(response.status)
        response.headers.forEach((value, name) => {
          if (name !== 'set-cookie' && name !== 'content-length') reply.header(name, value)
        })
        const setCookies = response.headers.getSetCookie()
        if (setCookies.length > 0) reply.header('set-cookie', setCookies)
        reply.header('cache-control', 'no-store')
        return reply.send(Buffer.from(await response.arrayBuffer()))
      },
    })
  }
}
