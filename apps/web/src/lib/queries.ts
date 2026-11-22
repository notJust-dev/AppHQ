import { queryOptions } from '@tanstack/react-query'
import { getAppTimelineFn, getOverviewFn, listPostsFn } from '@/fns/portfolio'
import { getSyncStatusFn, listAccountsFn, listAppsFn } from '@/fns/settings'
import { listAssetsFn } from '@/fns/assets'
import { metaSetupFn } from '@/fns/meta'
import { tiktokSetupFn } from '@/fns/tiktok'
import { getMonetisationPerformanceFn, getSocialPerformanceFn, getStorePerformanceFn } from '@/fns/performance'

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

export const metaSetupQuery = () =>
  queryOptions({ queryKey: ['meta-setup'], queryFn: () => metaSetupFn() })

export const assetsQuery = () => queryOptions({ queryKey: ['assets'], queryFn: () => listAssetsFn() })

export const appsQuery = () => queryOptions({ queryKey: ['apps'], queryFn: () => listAppsFn() })

export const accountsQuery = () =>
  queryOptions({ queryKey: ['accounts'], queryFn: () => listAccountsFn() })

export const syncStatusQuery = () =>
  queryOptions({ queryKey: ['sync-status'], queryFn: () => getSyncStatusFn() })

/** The dates of a performance page, and the app it is limited to, if any. */
type PerformanceInput = { from: string; to: string; appId?: string }

export const socialPerformanceQuery = (input: PerformanceInput) =>
  queryOptions({
    queryKey: ['performance', 'social', input.from, input.to, input.appId ?? 'all'],
    queryFn: () => getSocialPerformanceFn({ data: input }),
  })

export const storePerformanceQuery = (input: PerformanceInput) =>
  queryOptions({
    queryKey: ['performance', 'store', input.from, input.to, input.appId ?? 'all'],
    queryFn: () => getStorePerformanceFn({ data: input }),
  })

export const monetisationPerformanceQuery = (input: PerformanceInput) =>
  queryOptions({
    queryKey: ['performance', 'monetisation', input.from, input.to, input.appId ?? 'all'],
    queryFn: () => getMonetisationPerformanceFn({ data: input }),
  })

export type SocialPerformance = Awaited<ReturnType<typeof getSocialPerformanceFn>>
export type StorePerformance = Awaited<ReturnType<typeof getStorePerformanceFn>>
export type MonetisationPerformance = Awaited<ReturnType<typeof getMonetisationPerformanceFn>>
/** One series of a performance page, whichever page. */
export type PerformanceSeries =
  | SocialPerformance['series'][number]
  | StorePerformance['series'][number]
  | MonetisationPerformance['series'][number]

export type Overview = Awaited<ReturnType<typeof getOverviewFn>>

/**
 * Which headline totals rest on reported numbers. An API from before this field existed (for a
 * moment during a deploy, when the dashboard is newer) sends none; every total then counts as
 * reported, as it did before.
 */
export const reportingOf = (value: Overview['reporting'] | undefined): Overview['reporting'] =>
  value ?? { downloads: true, revenue: true, socialViews: true }
export type Timeline = NonNullable<Awaited<ReturnType<typeof getAppTimelineFn>>>
export type AppSummary = Awaited<ReturnType<typeof listAppsFn>>[number]
export type SyncRun = Awaited<ReturnType<typeof getSyncStatusFn>>[number]
export type AccountFamily = Awaited<ReturnType<typeof listAccountsFn>>[number]
export type Post = Awaited<ReturnType<typeof listPostsFn>>[number]
export type TikTokSetup = Awaited<ReturnType<typeof tiktokSetupFn>>
export type MetaSetup = Awaited<ReturnType<typeof metaSetupFn>>
export type Asset = Awaited<ReturnType<typeof listAssetsFn>>[number]
