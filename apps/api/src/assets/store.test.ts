import { describe, expect, it } from 'vitest'
import { suggestApp } from './store.js'

const apps = [
  { id: 'tinykicks', name: 'TinyKicks' },
  { id: 'zenfit', name: 'Chair Yoga For Seniors: ZenFit' },
  { id: 'musly', name: 'AI Music Song Generator Musly' },
]
const suggest = (name: string, details: Record<string, unknown> | null = null) => suggestApp({ name, details }, apps)

describe('suggestApp', () => {
  it('finds the app whose name a Page or account carries', () => {
    expect(suggest('TinyKicks Baby Kick Tracker')).toBe('tinykicks')
    expect(suggest('ZenFit - Chair Yoga')).toBe('zenfit')
    expect(suggest('@getzenfit')).toBe('zenfit')
    expect(suggest('@tinykicktracker')).toBeNull()
  })

  it('prefers a Play title over the package name', () => {
    expect(suggest('com.example.songs', { title: 'Musly: AI Song Maker' })).toBe('musly')
  })

  it('suggests nothing for a name that matches no app', () => {
    expect(suggest('Dev Diaries')).toBeNull()
    expect(suggest('@vadimnotjustdev')).toBeNull()
  })
})
