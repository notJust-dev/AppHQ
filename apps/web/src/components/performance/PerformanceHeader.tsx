import { PageHeader } from '@/components/PageHeader'
import { RangeSwitch } from '@/components/RangeSwitch'
import { formatDay } from '@/lib/format'
import { RANGE_DAYS, type RangeKey } from '@/lib/range'

/**
 * The top of a performance page: its name, what it shows, and the range. The app (or all of
 * them) is chosen in the top bar; both live in the address and stay chosen on the next page.
 */
export function PerformanceHeader(props: {
  title: string
  description: string
  range: RangeKey
  dates: { from: string; to: string }
}) {
  return (
    <PageHeader
      title={props.title}
      scoped
      description={
        <>
          {props.description}{' '}
          <span className="whitespace-nowrap">
            {formatDay(props.dates.from)} to {formatDay(props.dates.to)}, against the {RANGE_DAYS[props.range]} days before.
          </span>
        </>
      }
      actions={<RangeSwitch current={props.range} />}
    />
  )
}
