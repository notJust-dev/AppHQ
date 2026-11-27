import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query'
import { getAppFlowFn, getAppTimelineFn, getOverviewFn, listPostsFn } from '@/fns/portfolio'
import { getSyncStatusFn, listAccountsFn, listAppsFn } from '@/fns/settings'
import { listAssetsFn } from '@/fns/assets'
import { metaSetupFn } from '@/fns/meta'
import { tiktokSetupFn } from '@/fns/tiktok'
import { youtubeSetupFn } from '@/fns/youtube'
import { getMonetisationPerformanceFn, getSocialPerformanceFn, getStorePerformanceFn } from '@/fns/performance'
import { listReviewsFn, reviewSummaryFn, unreadReviewsFn } from '@/fns/reviews'
import { getSearchPerformanceFn, searchTopFn } from '@/fns/search'

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

export const flowQuery = (appId: string, dates: { from: string; to: string }) =>
  queryOptions({
    queryKey: ['flow', appId, dates.from, dates.to],
    queryFn: () => getAppFlowFn({ data: { appId, ...dates } }),
  })

/** The posts published in the range: one app's, or every app's without one. */
export const postsQuery = (appId: string | undefined, dates: { from: string; to: string }) =>
  queryOptions({
    queryKey: ['posts', appId ?? 'all', dates.from, dates.to],
    queryFn: () => listPostsFn({ data: { appId, ...dates } }),
  })

export const tiktokSetupQuery = () =>
  queryOptions({ queryKey: ['tiktok-setup'], queryFn: () => tiktokSetupFn() })

export const youtubeSetupQuery = () =>
  queryOptions({ queryKey: ['youtube-setup'], queryFn: () => youtubeSetupFn() })

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

export const searchPerformanceQuery = (input: PerformanceInput) =>
  queryOptions({
    queryKey: ['performance', 'search', input.from, input.to, input.appId ?? 'all'],
    queryFn: () => getSearchPerformanceFn({ data: input }),
  })

/** The top queries or pages, read live from Google; kept a few minutes, as Google is slow. */
export const searchTopQuery = (input: PerformanceInput & { dimension: 'query' | 'page' }) =>
  queryOptions({
    queryKey: ['search-top', input.dimension, input.from, input.to, input.appId ?? 'all'],
    queryFn: () => searchTopFn({ data: input }),
    staleTime: 5 * 60_000,
  })

export type SearchPerformance = Awaited<ReturnType<typeof getSearchPerformanceFn>>
export type SocialPerformance = Awaited<ReturnType<typeof getSocialPerformanceFn>>
export type StorePerformance = Awaited<ReturnType<typeof getStorePerformanceFn>>
export type MonetisationPerformance = Awaited<ReturnType<typeof getMonetisationPerformanceFn>>
/** One series of a performance page, whichever page. */
export type PerformanceSeries =
  | SocialPerformance['series'][number]
  | StorePerformance['series'][number]
  | MonetisationPerformance['series'][number]
  | SearchPerformance['series'][number]

export interface ReviewFilters {
  appId?: string
  store?: 'app_store' | 'google_play'
  rating?: number
  unread?: boolean
}

/** The inbox, page by page, newest first. */
export const reviewsQuery = (filters: ReviewFilters) =>
  infiniteQueryOptions({
    queryKey: ['reviews', 'list', filters],
    queryFn: ({ pageParam }) => listReviewsFn({ data: { ...filters, before: pageParam ?? undefined } }),
    initialPageParam: null as { createdAt: string; id: string } | null,
    getNextPageParam: (page) => page.next,
  })

export const reviewSummaryQuery = (filters: Pick<ReviewFilters, 'appId' | 'store'>) =>
  queryOptions({
    queryKey: ['reviews', 'summary', filters],
    queryFn: () => reviewSummaryFn({ data: filters }),
  })

/** How many reviews wait in the inbox, for the sidebar. */
export const unreadReviewsQuery = () =>
  queryOptions({ queryKey: ['reviews', 'unread'], queryFn: () => unreadReviewsFn(), staleTime: 60_000 })

export type Review = Awaited<ReturnType<typeof listReviewsFn>>['reviews'][number]
export type ReviewSummary = Awaited<ReturnType<typeof reviewSummaryFn>>

export type Overview = Awaited<ReturnType<typeof getOverviewFn>>

/**
 * Which headline totals rest on reported numbers. An API from before this field existed (for a
 * moment during a deploy, when the dashboard is newer) sends none; every total then counts as
 * reported, as it did before.
 */
export const reportingOf = (value: Overview['reporting'] | undefined): Overview['reporting'] =>
  value ?? { downloads: true, revenue: true, socialViews: true }
export type Timeline = NonNullable<Awaited<ReturnType<typeof getAppTimelineFn>>>
export type AppFlow = NonNullable<Awaited<ReturnType<typeof getAppFlowFn>>>
export type AppSummary = Awaited<ReturnType<typeof listAppsFn>>[number]
export type SyncRun = Awaited<ReturnType<typeof getSyncStatusFn>>[number]
export type AccountFamily = Awaited<ReturnType<typeof listAccountsFn>>[number]
export type Post = Awaited<ReturnType<typeof listPostsFn>>[number]
export type TikTokSetup = Awaited<ReturnType<typeof tiktokSetupFn>>
export type MetaSetup = Awaited<ReturnType<typeof metaSetupFn>>
export type YouTubeSetup = Awaited<ReturnType<typeof youtubeSetupFn>>
export type Asset = Awaited<ReturnType<typeof listAssetsFn>>[number]
