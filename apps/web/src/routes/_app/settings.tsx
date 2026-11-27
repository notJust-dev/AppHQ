import { Outlet, createFileRoute } from '@tanstack/react-router'

/**
 * Settings: what feeds the dashboard. Apps (`settings.apps.*`) says which sources make up each
 * app; Integrations (`settings.integrations.*`) connects the services that find those sources.
 * Every page here is framed by `SettingsPage`.
 */
export const Route = createFileRoute('/_app/settings')({
  component: Outlet,
})
