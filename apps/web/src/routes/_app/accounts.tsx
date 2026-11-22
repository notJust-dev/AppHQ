import { Outlet, createFileRoute } from '@tanstack/react-router'

/**
 * The Accounts section: an overview of every source (`accounts.index.tsx`) and a page to set up
 * each one (`accounts.app-store.tsx` and its siblings).
 */
export const Route = createFileRoute('/_app/accounts')({
  component: Outlet,
})
