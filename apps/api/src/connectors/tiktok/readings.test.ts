import { describe, expect, it } from 'vitest'
import type { TikTokVideo } from './client.js'
import { lacksViews, readVideos } from './readings.js'

const video = (id: string, counts: Partial<TikTokVideo> = {}): TikTokVideo => ({
  id,
  create_time: 1_763_000_000,
  ...counts,
})
const nothingStored = new Map<string, { views: number }>()

describe('lacksViews', () => {
  it('is true without a count, with null and with zero', () => {
    expect(lacksViews(video('v1'))).toBe(true)
    expect(lacksViews(video('v1', { view_count: null }))).toBe(true)
    expect(lacksViews(video('v1', { view_count: 0 }))).toBe(true)
    expect(lacksViews(video('v1', { view_count: 1 }))).toBe(false)
  })
})

describe('readVideos', () => {
  it('takes videos with views as read, in the order they were listed', () => {
    const listed = [video('v1', { view_count: 300 }), video('v2', { view_count: 12 })]

    expect(readVideos({ listed, again: [], stored: nothingStored })).toEqual({
      videos: listed,
      recovered: 0,
      skipped: 0,
    })
  })

  it('takes a video that came without views from the second answer', () => {
    const result = readVideos({
      listed: [video('v1', { view_count: 300 }), video('v2', { view_count: 0, like_count: 40 }), video('v3')],
      again: [video('v3', { view_count: 7_000 }), video('v2', { view_count: 5_200, like_count: 41 })],
      stored: nothingStored,
    })

    expect(result.videos.map((v) => [v.id, v.view_count, v.like_count])).toEqual([
      ['v1', 300, undefined],
      ['v2', 5_200, 41],
      ['v3', 7_000, undefined],
    ])
    expect(result).toMatchObject({ recovered: 2, skipped: 0 })
  })

  it('leaves out a video that has no count in either answer', () => {
    const result = readVideos({
      listed: [video('v1'), video('v2', { view_count: null })],
      again: [video('v2')],
      stored: nothingStored,
    })

    expect(result).toEqual({ videos: [], recovered: 0, skipped: 2 })
  })

  it('does not believe zero views for a video with likes, comments or shares', () => {
    const result = readVideos({
      listed: [
        video('v1', { view_count: 0, like_count: 3 }),
        video('v2', { view_count: 0 }),
        video('v3', { view_count: 0 }),
      ],
      // Engagement in either answer is enough.
      again: [video('v1', { view_count: 0 }), video('v2', { view_count: 0, share_count: 1 })],
      stored: nothingStored,
    })

    expect(result.videos.map((v) => v.id)).toEqual(['v3'])
    expect(result).toMatchObject({ recovered: 0, skipped: 2 })
  })

  it('does not believe zero views for a video stored with views', () => {
    const result = readVideos({
      listed: [video('v1', { view_count: 0 }), video('v2', { view_count: 0 })],
      again: [video('v1', { view_count: 0 }), video('v2', { view_count: 0 })],
      stored: new Map([
        ['v1', { views: 900 }],
        ['v2', { views: 0 }],
      ]),
    })

    expect(result.videos.map((v) => v.id)).toEqual(['v2'])
    expect(result).toMatchObject({ recovered: 0, skipped: 1 })
  })

  it('believes zero for a video nobody has watched yet, even without a second answer', () => {
    const result = readVideos({
      listed: [video('v1', { view_count: 0, like_count: 0 }), video('v2')],
      again: [video('v2', { view_count: 0 })],
      stored: nothingStored,
    })

    expect(result.videos.map((v) => [v.id, v.view_count])).toEqual([
      ['v1', 0],
      ['v2', 0],
    ])
    expect(result).toMatchObject({ recovered: 0, skipped: 0 })
  })
})
