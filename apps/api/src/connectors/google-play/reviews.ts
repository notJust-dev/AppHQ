import type { ReviewReading } from '../../reviews/save.js'
import { pick, records } from './reports.js'

/**
 * Google Play keeps every review in monthly files in the same bucket as the statistics, e.g.
 * `reviews/reviews_com.example.app_202611.csv`, so the key that reads installs reads reviews
 * too, with their full history (the Play Developer API only returns the last week).
 */
export const REVIEWS_PREFIX = 'reviews/reviews_'

export interface ReviewsFile {
  name: string
  packageName: string
  /** YYYYMM */
  month: string
}

export function parseReviewsName(name: string): ReviewsFile | null {
  const match = /^reviews\/reviews_(.+)_(\d{6})\.csv$/.exec(name)
  if (!match?.[1] || !match[2]) return null
  return { name, packageName: match[1], month: match[2] }
}

const millis = (value: string | undefined) => {
  if (!value) return null
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? new Date(number) : null
}

const text = (value: string | undefined) => {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

/**
 * The written reviews in one monthly file. Ratings left without a title or text are skipped, as
 * the App Store's API does not return those either, so both stores mean the same by a review.
 */
export function readPlayReviews(csv: string, appId: string, packageName: string): ReviewReading[] {
  const readings: ReviewReading[] = []
  for (const record of records(csv)) {
    const title = text(pick(record, ['review title']))
    const body = text(pick(record, ['review text']))
    if (!title && !body) continue
    const rating = Number(pick(record, ['star rating']))
    const submitted =
      millis(pick(record, ['review submit millis since epoch'])) ??
      (pick(record, ['review submit date and time']) ? new Date(pick(record, ['review submit date and time'])!) : null)
    if (!submitted || Number.isNaN(submitted.getTime()) || !(rating >= 1 && rating <= 5)) continue

    const url = text(pick(record, ['review link']))
    const reviewId = url ? /reviewId=([^&#]+)/.exec(url)?.[1] : undefined
    readings.push({
      appId,
      store: 'google_play',
      externalId: reviewId ? decodeURIComponent(reviewId) : `${packageName}:${submitted.getTime()}`,
      rating,
      title,
      body,
      language: text(pick(record, ['reviewer language'])),
      appVersion: text(pick(record, ['app version name'])),
      device: text(pick(record, ['device'])),
      url,
      createdAt: submitted,
      editedAt: millis(pick(record, ['review last update millis since epoch'])),
      reply: text(pick(record, ['developer reply text'])),
      repliedAt: millis(pick(record, ['developer reply millis since epoch'])),
    })
  }
  return readings
}
