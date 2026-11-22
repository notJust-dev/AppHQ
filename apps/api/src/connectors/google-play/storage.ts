import { z } from 'zod'

/**
 * The two Cloud Storage JSON API calls the Play reports need: list objects under a prefix, and
 * download one. Google Play's report buckets live in a Google-owned project, so only objects can
 * be read, never the bucket itself.
 */

const MAX_PAGES = 50

export class StorageError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'StorageError'
  }

  /** The service account cannot see the bucket: not invited in Play Console yet, or too recently. */
  get isAccessProblem(): boolean {
    return this.status === 401 || this.status === 403
  }
}

const listSchema = z.object({
  items: z.array(z.object({ name: z.string(), updated: z.string().optional(), size: z.string().optional() })).optional(),
  nextPageToken: z.string().optional(),
})

export type StorageObject = NonNullable<z.infer<typeof listSchema>['items']>[number]

export function createStorageClient(options: {
  token: () => Promise<string>
  fetch?: typeof fetch
  /** Overridable so the connector can run against a local stand-in. */
  baseUrl?: string
}) {
  const doFetch = options.fetch ?? fetch
  const base = (options.baseUrl ?? process.env.GOOGLE_STORAGE_URL ?? 'https://storage.googleapis.com').replace(/\/$/, '')

  async function get(url: URL): Promise<Response> {
    const response = await doFetch(url, {
      headers: { authorization: `Bearer ${await options.token()}` },
      signal: AbortSignal.timeout(60_000),
    })
    if (response.ok) return response
    const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null
    throw new StorageError(response.status, body?.error?.message || `Cloud Storage answered ${response.status}`)
  }

  return {
    async list(bucket: string, prefix: string): Promise<StorageObject[]> {
      const objects: StorageObject[] = []
      let pageToken: string | undefined
      for (let page = 0; page < MAX_PAGES; page++) {
        const url = new URL(`${base}/storage/v1/b/${encodeURIComponent(bucket)}/o`)
        url.searchParams.set('prefix', prefix)
        url.searchParams.set('fields', 'items(name,updated,size),nextPageToken')
        if (pageToken) url.searchParams.set('pageToken', pageToken)
        const parsed = listSchema.parse(await (await get(url)).json())
        objects.push(...(parsed.items ?? []))
        pageToken = parsed.nextPageToken
        if (!pageToken) break
      }
      return objects
    },

    async download(bucket: string, name: string): Promise<Buffer> {
      const url = new URL(`${base}/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(name)}`)
      url.searchParams.set('alt', 'media')
      return Buffer.from(await (await get(url)).arrayBuffer())
    },
  }
}

export type StorageClient = ReturnType<typeof createStorageClient>
