import { describe, expect, it } from 'vitest'
import { slugify, uniqueSlug } from './slug.js'

describe('slugify', () => {
  it('lowercases and joins words with hyphens', () => {
    expect(slugify('Habit Loop: Tracker!')).toBe('habit-loop-tracker')
  })

  it('strips accents and falls back when nothing is left', () => {
    expect(slugify('Café Niño')).toBe('cafe-nino')
    expect(slugify('日本語')).toBe('app')
  })
})

describe('uniqueSlug', () => {
  it('adds a number when the slug is taken', () => {
    expect(uniqueSlug('Trailmate', new Set())).toBe('trailmate')
    expect(uniqueSlug('Trailmate', new Set(['trailmate', 'trailmate-2']))).toBe('trailmate-3')
  })

  it('keeps real apps out of the demo namespace', () => {
    expect(uniqueSlug('Demo App', new Set())).toBe('app-demo-app')
  })
})
