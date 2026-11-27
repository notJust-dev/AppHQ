import { useSyncExternalStore } from 'react'

/**
 * Privacy mode blurs whatever could tell someone which apps and accounts these are (app names
 * and icons, bundle ids, social handles, websites, search terms, posts, reviews), for recording
 * a video or sharing the screen. Anything that names one is marked `data-private` (see
 * `Private`); the stylesheet blurs those while the page carries `data-privacy="on"`. Numbers stay
 * readable. Kept in this browser only.
 */
const KEY = 'privacy'

/** Runs in the page head before anything paints, so no name shows even for a moment. */
export const PRIVACY_SCRIPT = `try{if(localStorage.getItem('${KEY}')==='on')document.documentElement.dataset.privacy='on'}catch(e){}`

const listeners = new Set<() => void>()

export function setPrivacy(on: boolean) {
  try {
    if (on) localStorage.setItem(KEY, 'on')
    else localStorage.removeItem(KEY)
  } catch {
    // Storage can be off (a private window); the mode then lasts for this page only.
  }
  if (on) document.documentElement.dataset.privacy = 'on'
  else delete document.documentElement.dataset.privacy
  for (const listener of listeners) listener()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Whether privacy mode is on in this page right now. Off on the server. */
export function privacyOn(): boolean {
  return typeof document !== 'undefined' && document.documentElement.dataset.privacy === 'on'
}

/** Whether privacy mode is on. The server cannot know, so it renders as off until hydration. */
export function usePrivacy(): boolean {
  return useSyncExternalStore(subscribe, privacyOn, () => false)
}
