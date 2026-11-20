import { queryOptions } from '@tanstack/react-query'
import { getOverviewFn } from '../fns/portfolio'
import { getSyncStatusFn, listAccountsFn, listAppsFn } from '../fns/settings'

export const overviewQuery = (dates: { from: string; to: string }) =>
  queryOptions({
    queryKey: ['overview', dates.from, dates.to],
    queryFn: () => getOverviewFn({ data: dates }),
  })

export const appsQuery = () => queryOptions({ queryKey: ['apps'], queryFn: () => listAppsFn() })

export const accountsQuery = () =>
  queryOptions({ queryKey: ['accounts'], queryFn: () => listAccountsFn() })

export const syncStatusQuery = () =>
  queryOptions({ queryKey: ['sync-status'], queryFn: () => getSyncStatusFn() })

export type Overview = Awaited<ReturnType<typeof getOverviewFn>>
export type AppSummary = Awaited<ReturnType<typeof listAppsFn>>[number]
export type SyncRun = Awaited<ReturnType<typeof getSyncStatusFn>>[number]
export type Account = Awaited<ReturnType<typeof listAccountsFn>>[number]
