import type { IsoDate } from '../../lib/dates.js'
import { parseIsoDate } from '../../lib/dates.js'
import type { ReviewReading } from '../../reviews/save.js'
import { AppStoreError, type AppStoreClient } from './client.js'

/** Whether the key may read customer reviews, as of the last sync. */
export interface ReviewsState {
  access: 'ok' | 'forbidden'
  checkedAt: string
}

export const readReviewsState = (details: unknown): ReviewsState | null => {
  const state = (details as { reviews?: ReviewsState } | null)?.reviews
  return state?.access === 'ok' || state?.access === 'forbidden' ? state : null
}

/**
 * The written reviews of each tracked app since the range's first day. A key without the
 * Admin, App Manager or Customer Support role cannot read reviews: that is recorded, not an
 * error, so downloads keep syncing.
 */
export async function syncAppStoreReviews(options: {
  client: Pick<AppStoreClient, 'listReviews'>
  tracked: { id: string; iosAppId: string; name: string }[]
  range: { from: IsoDate }
  now?: Date
}): Promise<{ readings: ReviewReading[]; state: ReviewsState; failures: string[] }> {
  const readings: ReviewReading[] = []
  const failures: string[] = []
  const since = parseIsoDate(options.range.from)
  let forbidden = false

  for (const app of options.tracked) {
    if (forbidden) break
    try {
      for (const review of await options.client.listReviews(app.iosAppId, since)) {
        readings.push({
          appId: app.id,
          store: 'app_store',
          externalId: review.id,
          rating: review.rating,
          title: review.title,
          body: review.body,
          author: review.author,
          territory: review.territory,
          createdAt: review.createdAt,
          reply: review.reply,
          repliedAt: review.repliedAt,
        })
      }
    } catch (err) {
      if (err instanceof AppStoreError && err.status === 403) {
        forbidden = true
      } else {
        failures.push(`reviews of ${app.name}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }

  return {
    readings: forbidden ? [] : readings,
    state: { access: forbidden ? 'forbidden' : 'ok', checkedAt: (options.now ?? new Date()).toISOString() },
    failures,
  }
}
