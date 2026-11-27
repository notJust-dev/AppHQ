import { createMemoryHistory, createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { describe, expect, it } from 'vitest'
import { dashboardSearchMiddlewares, dashboardSearchSchema } from './range'

const APP = '0b9c2f4e-6d1a-4c3b-9e2f-7a8b9c0d1e2f'
const OTHER = '5e4d3c2b-1a0f-4e9d-8c7b-6a5f4e3d2c1b'

/**
 * A dashboard like the real one, opened at `address`: the layout's search params over a few
 * pages. Returns where a link leads from there.
 */
function dashboardAt(address: string) {
  const root = createRootRoute({
    validateSearch: dashboardSearchSchema,
    search: { middlewares: dashboardSearchMiddlewares },
  })
  const page = (path: string) => createRoute({ getParentRoute: () => root, path })
  const router = createRouter({
    routeTree: root.addChildren([page('/'), page('/social'), page('/store')]),
    history: createMemoryHistory({ initialEntries: [address] }),
  })
  // `buildLocation` is typed for the real dashboard's pages; this router has its own few.
  const build = router.buildLocation as unknown as (link: Link & { _includeValidateSearch?: boolean }) => { href: string }

  return (link: Link) => {
    const written = build(link).href
    // Navigating also validates the search, which fills in the default range before the
    // middlewares see it. The address a link shows has to be the one it leads to.
    const committed = build({ ...link, _includeValidateSearch: true }).href
    expect(committed).toBe(written)
    return written
  }
}

type Search = Record<string, unknown>
interface Link {
  to: string
  search?: Search | ((previous: Search) => Search)
}

describe('the dashboard search params', () => {
  it('keeps the app and range on a link that names neither', () => {
    const link = dashboardAt(`/social?range=7d&app=${APP}`)
    expect(link({ to: '/store' })).toBe(`/store?range=7d&app=${APP}`)
    expect(link({ to: '/store', search: {} })).toBe(`/store?range=7d&app=${APP}`)
  })

  it('keeps the default range out of the address, so the bare address stays bare', () => {
    expect(dashboardAt('/social')({ to: '/' })).toBe('/')
    expect(dashboardAt('/social?range=28d')({ to: '/' })).toBe('/')
    expect(dashboardAt(`/social?app=${APP}`)({ to: '/store' })).toBe(`/store?app=${APP}`)
  })

  it('goes back to the default range when a link names it', () => {
    const link = dashboardAt(`/social?range=7d&app=${APP}`)
    expect(link({ to: '.', search: (previous) => ({ ...previous, range: '28d' }) })).toBe(`/social?app=${APP}`)
    expect(link({ to: '/store', search: { range: '28d' } })).toBe(`/store?app=${APP}`)
  })

  it('takes another range or app from the link that names one', () => {
    const link = dashboardAt(`/social?range=7d&app=${APP}`)
    expect(link({ to: '/store', search: { range: '90d' } })).toBe(`/store?range=90d&app=${APP}`)
    expect(link({ to: '/store', search: (previous) => ({ ...previous, app: OTHER }) })).toBe(
      `/store?range=7d&app=${OTHER}`,
    )
  })

  it('drops the app when a link clears it', () => {
    const link = dashboardAt(`/social?range=7d&app=${APP}`)
    expect(link({ to: '.', search: (previous) => ({ ...previous, app: undefined }) })).toBe('/social?range=7d')
  })

  it('falls back to 28 days and every app when the address makes no sense', () => {
    expect(dashboardAt('/social?range=forever&app=not-an-id')({ to: '/store' })).toBe('/store')
  })
})
