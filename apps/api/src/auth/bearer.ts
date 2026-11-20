import { createHash, timingSafeEqual } from 'node:crypto'
import type { onRequestAsyncHookHandler } from 'fastify'

const digest = (value: string) => createHash('sha256').update(value).digest()

/**
 * Rejects requests that do not carry `Authorization: Bearer <expected>`. Both sides are hashed
 * first so the comparison is constant-time whatever the lengths.
 */
export function requireBearerToken(expected: string): onRequestAsyncHookHandler {
  const expectedDigest = digest(expected)
  return async (request, reply) => {
    const header = request.headers.authorization ?? ''
    const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : ''
    if (!timingSafeEqual(digest(token), expectedDigest)) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
  }
}
