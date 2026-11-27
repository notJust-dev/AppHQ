import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { PageHeader } from '@/components/PageHeader'
import { Private } from '@/components/Private'
import { RangeSwitch } from '@/components/RangeSwitch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatDay } from '@/lib/format'
import { appsQuery } from '@/lib/queries'
import { RANGE_DAYS, type RangeKey } from '@/lib/range'

/** The select's value for every app; Radix keeps the empty string for its placeholder. */
const ALL = 'all'

/**
 * The top of a performance page: its name and what it shows, and the two choices every such
 * page has: which app (or all of them) and which range. Both live in the address, and stay
 * chosen on the next page.
 */
export function PerformanceHeader(props: {
  title: string
  description: string
  range: RangeKey
  app: string | undefined
  dates: { from: string; to: string }
}) {
  return (
    <PageHeader
      title={props.title}
      description={
        <>
          {props.description}{' '}
          <span className="whitespace-nowrap">
            {formatDay(props.dates.from)} to {formatDay(props.dates.to)}, against the {RANGE_DAYS[props.range]} days before.
          </span>
        </>
      }
      actions={
        <>
          <AppFilter value={props.app} />
          <RangeSwitch current={props.range} />
        </>
      }
    />
  )
}

function AppFilter({ value }: { value: string | undefined }) {
  const { data: apps = [] } = useQuery(appsQuery())
  const navigate = useNavigate()
  const chosen = apps.find((app) => app.id === value)
  const label = !chosen ? 'All apps' : chosen.kind === 'portfolio' ? 'Shared accounts' : <Private>{chosen.name}</Private>

  return (
    <Select
      value={value ?? ALL}
      onValueChange={(next) =>
        void navigate({
          to: '.',
          search: (previous: Record<string, unknown>) => ({ ...previous, app: next === ALL ? undefined : next }),
        })
      }
    >
      <SelectTrigger aria-label="App" className="w-56 bg-card">
        {/* Named here too, so the server draws it before the list of apps exists in the page. */}
        <SelectValue>{label}</SelectValue>
      </SelectTrigger>
      <SelectContent align="end">
        <SelectItem value={ALL}>All apps</SelectItem>
        {apps.map((app) => (
          <SelectItem key={app.id} value={app.id}>
            {app.kind === 'portfolio' ? 'Shared accounts' : <Private>{app.name}</Private>}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
