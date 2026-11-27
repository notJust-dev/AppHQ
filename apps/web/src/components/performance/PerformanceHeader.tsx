import { PageHeader, type Crumb } from '@/components/PageHeader'
import { RangeSwitch } from '@/components/RangeSwitch'
import { formatDay } from '@/lib/format'
import { RANGE_DAYS, type RangeKey } from '@/lib/range'

/**
 * The top of a performance page: its name, what it shows, and the range. The app (or all of
 * them) is chosen in the top bar; both live in the address and stay chosen on the next page.
 */
export function PerformanceHeader(props: {
  title: string
  /** The section a subpage sits in, such as Social for Social › Posts. */
  crumbs?: Crumb[]
  description: string
  range: RangeKey
  dates: { from: string; to: string }
  /** Whether the page sets its numbers against the days before; a plain list doesn't. */
  compared?: boolean
}) {
  const compared = props.compared ?? true
  return (
    <PageHeader
      title={props.title}
      crumbs={props.crumbs}
      scoped
      description={
        <>
          {props.description}{' '}
          <span className="whitespace-nowrap">
            {formatDay(props.dates.from)} to {formatDay(props.dates.to)}
            {compared ? `, against the ${RANGE_DAYS[props.range]} days before.` : '.'}
          </span>
        </>
      }
      actions={<RangeSwitch current={props.range} />}
    />
  )
}
