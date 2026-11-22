import { queryOptions } from '@tanstack/react-query'
import { getAppTimelineFn, getOverviewFn, listPostsFn } from '../fns/portfolio'
import { getSyncStatusFn, listAccountsFn, listAppsFn } from '../fns/settings'
import { tiktokSetupFn } from '../fns/tiktok'

export const overviewQuery = (dates: { from: string; to: string }) =>
  queryOptions({
    queryKey: ['overview', dates.from, dates.to],
    queryFn: () => getOverviewFn({ data: dates }),
  })

export const timelineQuery = (appId: string, dates: { from: string; to: string }) =>
  queryOptions({
    queryKey: ['timeline', appId, dates.from, dates.to],
    queryFn: () => getAppTimelineFn({ data: { appId, ...dates } }),
  })

export const postsQuery = (appId: string, dates: { from: string; to: string }) =>
  queryOptions({
    queryKey: ['posts', appId, dates.from, dates.to],
    queryFn: () => listPostsFn({ data: { appId, ...dates } }),
  })

export const tiktokSetupQuery = () =>
  queryOptions({ queryKey: ['tiktok-setup'], queryFn: () => tiktokSetupFn() })

export const appsQuery = () => queryOptions({ queryKey: ['apps'], queryFn: () => listAppsFn() })

export const accountsQuery = () =>
  queryOptions({ queryKey: ['accounts'], queryFn: () => listAccountsFn() })

export const syncStatusQuery = () =>
  queryOptions({ queryKey: ['sync-status'], queryFn: () => getSyncStatusFn() })

export type Overview = Awaited<ReturnType<typeof getOverviewFn>>
export type Timeline = NonNullable<Awaited<ReturnType<typeof getAppTimelineFn>>>
export type AppSummary = Awaited<ReturnType<typeof listAppsFn>>[number]
export type SyncRun = Awaited<ReturnType<typeof getSyncStatusFn>>[number]
export type Account = Awaited<ReturnType<typeof listAccountsFn>>[number]
export type Post = Awaited<ReturnType<typeof listPostsFn>>[number]
export type TikTokSetup = Awaited<ReturnType<typeof tiktokSetupFn>>
