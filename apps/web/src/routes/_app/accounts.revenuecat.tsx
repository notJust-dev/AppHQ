import { useSuspenseQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { Section, SourcePage } from '../../components/accounts/shared'
import { ATTENTION } from '../../lib/assets'
import { formatMoment } from '../../lib/format'
import { appsQuery, assetsQuery } from '../../lib/queries'

export const Route = createFileRoute('/_app/accounts/revenuecat')({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(appsQuery()),
      context.queryClient.ensureQueryData(assetsQuery()),
    ]),
  component: RevenueCatPage,
})

/**
 * A RevenueCat key belongs to one project, which belongs to one app, so keys are connected from
 * each app's Settings. This page only shows where every app stands.
 */
function RevenueCatPage() {
  const { data: apps } = useSuspenseQuery(appsQuery())
  const { data: assets } = useSuspenseQuery(assetsQuery())
  const ownApps = apps.filter((app) => app.kind !== 'portfolio')
  const waiting = assets.filter((asset) => asset.kind === 'revenuecat_project' && asset.appId === null && !asset.ignored)

  return (
    <SourcePage
      title="RevenueCat"
      intro="Revenue, MRR, trials and subscribers. A RevenueCat key belongs to one project, and a project to one app, so each app connects its own key in its Settings. About a year of history is fetched when it does."
    >
      <Section title="Projects by app">
        {ownApps.length === 0 ? (
          <p className="rounded-lg border border-line bg-surface px-6 py-4 text-sm text-ink-soft">
            No apps yet.{' '}
            <Link to="/apps/new" className="font-medium text-ink underline underline-offset-4">
              Add an app
            </Link>
            , then connect its RevenueCat project in its Settings.
          </p>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line bg-surface text-sm">
            {ownApps.map((app) => {
              const project = app.assets.find((asset) => asset.kind === 'revenuecat_project')
              const attention = project ? ATTENTION[project.status] : undefined
              return (
                <li key={app.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-6 py-3">
                  <span className="min-w-0 break-words">
                    <span className="font-medium">{app.name}</span>
                    <span className={`block text-xs ${attention ? 'font-medium' : 'text-ink-soft'}`}>
                      {project
                        ? [
                            project.name,
                            attention ? `key ${attention}` : 'connected',
                            project.lastSyncedAt ? `synced ${formatMoment(project.lastSyncedAt)}` : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')
                        : 'No project connected'}
                    </span>
                  </span>
                  <Link
                    to="/apps/$appId/settings"
                    params={{ appId: app.id }}
                    search={{ range: '28d' }}
                    aria-label={`${project ? 'Settings' : 'Connect a project'} for ${app.name}`}
                    className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                      project ? 'border border-line bg-surface' : 'bg-ink text-surface'
                    }`}
                  >
                    {project ? 'Settings' : 'Connect'}
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </Section>

      {waiting.length > 0 && (
        <Section title="Not in an app">
          <p className="text-sm">
            {waiting.map((asset) => asset.name).join(', ')} {waiting.length === 1 ? 'is' : 'are'} connected
            but not part of an app.{' '}
            <Link to="/apps" className="font-medium underline underline-offset-4">
              Link {waiting.length === 1 ? 'it' : 'them'} on the Apps page
            </Link>
            .
          </p>
        </Section>
      )}
    </SourcePage>
  )
}
