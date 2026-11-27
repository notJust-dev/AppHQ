import * as Sentry from '@sentry/react'
import { useSyncExternalStore } from 'react'
import { errorReportingStarted, onErrorReportingStart } from '@/lib/errors'
import { privacyOn } from '@/lib/privacy'

/**
 * Sentry's feedback form, opened from the sidebar. It is there only while error reporting is on
 * (SENTRY_DSN is set), and sends to the same place. What is sent: the message, the email if the
 * person gives one, the page address without its query or fragment, and a screenshot only if they
 * add one. Privacy mode leaves the screenshot button out, since a screenshot shows the names it
 * blurs only on screen.
 */

/** Whether the form can open. False on the server and until error reporting starts. */
export function useFeedbackAvailable(): boolean {
  return useSyncExternalStore(onErrorReportingStart, feedbackAvailable, () => false)
}

function feedbackAvailable(): boolean {
  return errorReportingStarted() && Sentry.getFeedback() !== undefined
}

let opening = false

/** Opens the form, in the theme the page shows. Does nothing while feedback is off. */
export async function openFeedbackForm() {
  const feedback = Sentry.getFeedback()
  if (!feedback || opening) return
  opening = true
  try {
    const theme = document.documentElement.dataset.theme
    feedback.setTheme(theme === 'light' || theme === 'dark' ? theme : 'system')
    // Built for each opening, so a change to privacy mode applies to the next one.
    const form = await feedback.createForm({
      enableScreenshot: !privacyOn(),
      onFormClose: () => form.removeFromDom(),
      onFormSubmitted: () => form.removeFromDom(),
    })
    form.appendToDom()
    form.open()
  } finally {
    opening = false
  }
}
