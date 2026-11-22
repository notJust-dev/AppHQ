import { formatCount, formatDay } from './format'
import type { Post } from './queries'

export type Lift = Post['downloadLift']

const signed = (n: number) => (n > 0 ? `+${formatCount(n)}` : n < 0 ? `−${formatCount(-n)}` : '0')
const signedPercent = (ratio: number) => {
  const percent = Math.round(ratio * 100)
  return percent > 0 ? `+${percent}%` : percent < 0 ? `−${-percent}%` : '0%'
}

/** For a table cell: "+232 (+129%)", or why there is no number. */
export function liftShort(lift: Lift): string {
  switch (lift.status) {
    case 'ok':
      return lift.changeRatio === null
        ? signed(lift.change)
        : `${signed(lift.change)} (${signedPercent(lift.changeRatio)})`
    case 'too_recent':
      return 'Too recent'
    case 'no_baseline':
      return 'No baseline'
    case 'no_downloads':
      return '–'
  }
}

/** A sentence for the selected post, naming the three days it covers. */
export function liftSentence(lift: Lift, day: string): string {
  const days = (offset: number) => {
    const date = new Date(`${day}T00:00:00Z`)
    date.setUTCDate(date.getUTCDate() + offset)
    return formatDay(date.toISOString().slice(0, 10))
  }
  switch (lift.status) {
    case 'ok':
      return (
        `Downloads ${days(0)} to ${days(2)}: ${formatCount(lift.downloads)}, against ` +
        `${formatCount(lift.expected)} at the week before's pace. ${liftShort(lift)}.`
      )
    case 'too_recent':
      return `Downloads for ${days(0)} to ${days(2)} are not all reported yet.`
    case 'no_baseline':
      return 'Too few days with downloads in the week before to compare against.'
    case 'no_downloads':
      return 'No downloads are reported around this post.'
  }
}
