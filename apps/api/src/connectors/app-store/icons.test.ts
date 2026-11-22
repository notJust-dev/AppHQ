import { describe, expect, it } from 'vitest'
import { AppStoreError, type AppStoreClient } from './client.js'
import { fetchAppIcons } from './icons.js'

/** A client that only answers icons: a link, null (no build), or an error to throw. */
function clientWith(answers: Record<string, string | null | Error>) {
  const asked: string[] = []
  const client = {
    async latestBuildIcon(appleId: string) {
      asked.push(appleId)
      const answer = answers[appleId]
      if (answer instanceof Error) throw answer
      return answer ?? null
    },
  } as unknown as AppStoreClient
  return { client, asked }
}

/** Stands in for the public App Store lookup. */
function lookup(results: { trackId: number; artworkUrl512?: string }[] | Error) {
  const asked: URL[] = []
  const impl = (async (target: Parameters<typeof fetch>[0]) => {
    asked.push(new URL(String(target)))
    if (results instanceof Error) throw results
    return new Response(JSON.stringify({ resultCount: results.length, results }))
  }) as typeof fetch
  return { impl, asked }
}

describe('fetchAppIcons', () => {
  it('takes build icons, and asks the public listing only for apps without one', async () => {
    const { client } = clientWith({ '111': 'https://img.example/one/256x256bb.png', '222': null })
    const store = lookup([{ trackId: 222, artworkUrl512: 'https://img.example/two/512x512bb.jpg' }])

    const icons = await fetchAppIcons({ client, appleIds: ['111', '222'], fetch: store.impl })

    expect(Object.fromEntries(icons)).toEqual({
      '111': 'https://img.example/one/256x256bb.png',
      // Asked for at the same size as build icons.
      '222': 'https://img.example/two/256x256bb.jpg',
    })
    expect(store.asked.map((url) => url.searchParams.get('id'))).toEqual(['222'])
  })

  it('stops asking App Store Connect after a refusal, and falls back to the listing', async () => {
    const refusal = new AppStoreError(403, 'FORBIDDEN_ERROR', 'This key cannot read builds')
    const { client, asked } = clientWith({ '111': refusal, '222': refusal, '333': refusal, '444': refusal, '555': refusal })
    const store = lookup([{ trackId: 111, artworkUrl512: 'https://img.example/one/512x512bb.jpg' }])

    const icons = await fetchAppIcons({ client, appleIds: ['111', '222', '333', '444', '555'], fetch: store.impl })

    // The four asked at once, and none after.
    expect(asked).toHaveLength(4)
    expect(Object.fromEntries(icons)).toEqual({ '111': 'https://img.example/one/256x256bb.jpg' })
  })

  it('never fails: an unreachable listing leaves the apps without icons', async () => {
    const { client } = clientWith({ '111': new Error('socket hang up') })
    const store = lookup(new Error('getaddrinfo ENOTFOUND'))

    expect((await fetchAppIcons({ client, appleIds: ['111'], fetch: store.impl })).size).toBe(0)
  })
})
