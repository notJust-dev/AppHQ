import { createFileRoute } from '@tanstack/react-router'
import { isServerConfigured } from '@/server/env'

/**
 * Public health check for uptime monitors and for verifying a deployment without signing in.
 * It says whether this server has its configuration and can reach the API, and nothing more:
 * which variable is missing is in the server log.
 */
export const Route = createFileRoute('/health')({
  server: {
    handlers: {
      GET: async () => {
        const configured = isServerConfigured()
        const api = await apiStatus(process.env.API_URL)
        const ok = configured && api === 'up'
        return Response.json({ ok, configured, api }, { status: ok ? 200 : 503 })
      },
    },
  },
})

async function apiStatus(apiUrl: string | undefined): Promise<'up' | 'down' | 'unset'> {
  if (!apiUrl) return 'unset'
  try {
    const response = await fetch(`${apiUrl}/health`, { signal: AbortSignal.timeout(3000) })
    return response.ok ? 'up' : 'down'
  } catch {
    return 'down'
  }
}
