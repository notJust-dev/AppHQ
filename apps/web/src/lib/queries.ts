import { queryOptions } from '@tanstack/react-query'
import { getOverviewFn } from '../fns/portfolio'

export const overviewQuery = (dates: { from: string; to: string }) =>
  queryOptions({
    queryKey: ['overview', dates.from, dates.to],
    queryFn: () => getOverviewFn({ data: dates }),
  })

export type Overview = Awaited<ReturnType<typeof getOverviewFn>>
