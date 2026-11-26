import type { TikTokVideo } from './client.js'

/** A video whose totals can be saved: TikTok gave its view count. */
export type ReadVideo = TikTokVideo & { view_count: number }

const hasViews = (video: TikTokVideo): video is ReadVideo =>
  typeof video.view_count === 'number' && video.view_count > 0

const hasEngagement = (video: TikTokVideo) =>
  (video.like_count ?? 0) > 0 || (video.comment_count ?? 0) > 0 || (video.share_count ?? 0) > 0

/** True for a video that came without views: no count at all, or zero. Worth asking for again. */
export const lacksViews = (video: TikTokVideo) => !hasViews(video)

/**
 * The videos whose totals can be saved, out of what TikTok listed. TikTok at times answers for
 * a watched video without its view count, or with zero. Saved as read, that zero would replace
 * the video's real total, and the whole total would count as gained once it came back.
 *
 * - A video with views is taken as read.
 * - One without is taken from the second answer, when that has views.
 * - Zero is believed only when an answer says zero, neither answer has likes, comments or
 *   shares, and no views are stored for the video: nobody has watched it yet.
 * - Any other video is left out, so that what is stored for it stays as it is.
 */
export function readVideos(params: {
  listed: readonly TikTokVideo[]
  /** The second answers for the videos that came without views; some may be missing. */
  again: readonly TikTokVideo[]
  /** What is already stored for those videos, by video id. */
  stored: ReadonlyMap<string, { views: number }>
}): { videos: ReadVideo[]; recovered: number; skipped: number } {
  const second = new Map(params.again.map((video) => [video.id, video]))
  const videos: ReadVideo[] = []
  let recovered = 0
  let skipped = 0

  for (const video of params.listed) {
    if (hasViews(video)) {
      videos.push(video)
      continue
    }
    const retry = second.get(video.id)
    if (retry && hasViews(retry)) {
      videos.push(retry)
      recovered++
      continue
    }
    const answers = retry ? [retry, video] : [video]
    const saidZero = answers.find((answer) => answer.view_count === 0)
    const watchedBefore = (params.stored.get(video.id)?.views ?? 0) > 0
    if (saidZero && !watchedBefore && !answers.some(hasEngagement)) {
      videos.push({ ...saidZero, view_count: 0 })
    } else {
      skipped++
    }
  }
  return { videos, recovered, skipped }
}
