import { describe, expect, it } from 'vitest'
import { parseReviewsName, readPlayReviews } from './reviews.js'

const HEADER =
  'Package Name,App Version Code,App Version Name,Reviewer Language,Device,Review Submit Date and Time,' +
  'Review Submit Millis Since Epoch,Review Last Update Date and Time,Review Last Update Millis Since Epoch,' +
  'Star Rating,Review Title,Review Text,Developer Reply Date and Time,Developer Reply Millis Since Epoch,' +
  'Developer Reply Text,Review Link'

describe('Google Play review files', () => {
  it('reads the package and month from a file name', () => {
    expect(parseReviewsName('reviews/reviews_com.example.app_202611.csv')).toEqual({
      name: 'reviews/reviews_com.example.app_202611.csv',
      packageName: 'com.example.app',
      month: '202611',
    })
    expect(parseReviewsName('stats/installs/installs_com.example.app_202611_overview.csv')).toBeNull()
  })

  it('keeps written reviews with their reply, and skips bare ratings', () => {
    const csv = [
      HEADER,
      'com.example.app,42,1.4.0,en,pixel8,2026-11-10T10:00:00Z,1762768800000,2026-11-11T08:00:00Z,1762848000000,4,,"Works well, but ""sync"" is slow",2026-11-12T09:00:00Z,1762938000000,Thanks! Faster sync is coming.,http://play.google.com/console/developers/1/app/2/user-feedback/review-details?reviewId=gp:AOq-abc&corpus=PUBLIC_REVIEWS',
      'com.example.app,42,1.4.0,de,a52,2026-11-10T11:00:00Z,1762772400000,,,5,,,,,,',
      'com.example.app,41,1.3.9,fr,,2026-11-09T11:00:00Z,1762686000000,,,1,Bug,Crash,,,,',
    ].join('\n')

    const reviews = readPlayReviews(csv, 'app-1', 'com.example.app')
    expect(reviews).toHaveLength(2)
    expect(reviews[0]).toMatchObject({
      appId: 'app-1',
      store: 'google_play',
      externalId: 'gp:AOq-abc',
      rating: 4,
      title: null,
      body: 'Works well, but "sync" is slow',
      language: 'en',
      appVersion: '1.4.0',
      device: 'pixel8',
      reply: 'Thanks! Faster sync is coming.',
    })
    expect(reviews[0]?.createdAt.toISOString()).toBe('2025-11-10T10:00:00.000Z')
    expect(reviews[0]?.editedAt?.toISOString()).toBe('2025-11-11T08:00:00.000Z')
    // Without a review link, the package and submit time stand in for an id.
    expect(reviews[1]).toMatchObject({ externalId: 'com.example.app:1762686000000', rating: 1, title: 'Bug' })
  })
})
