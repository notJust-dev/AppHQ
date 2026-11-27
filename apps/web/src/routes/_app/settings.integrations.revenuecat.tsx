import { useSuspenseQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { Private } from '@/components/Private'
import { Button } from '@/components/ui/button'
import { Section, SourcePage } from '@/components/integrations/shared'
import { ATTENTION } from '@/lib/assets'
import { formatMoment } from '@/lib/format'
import { appsQuery, assetsQuery } from '@/lib/queries'

export const Route = createFileRoute('/_app/settings/integrations/revenuecat')({
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
      family="revenuecat"
      title="RevenueCat"
      intro="Revenue, MRR, trials and subscribers. A RevenueCat key belongs to one project, and a project to one app, so each app connects its own key in its Settings. About a year of history is fetched when it does."
    >
      <Section title="Projects by app" flush>
        {ownApps.length === 0 ? (
          <p className="px-5 py-4 text-muted-foreground">
            No apps yet.{' '}
            <Link to="/settings/apps/new" className="font-medium text-foreground underline underline-offset-4">
              Add an app
            </Link>
            , then connect its RevenueCat project in its Settings.
          </p>
        ) : (
          <ul className="divide-y">
            {ownApps.map((app) => {
              const project = app.assets.find((asset) => asset.kind === 'revenuecat_project')
              const attention = project ? ATTENTION[project.status] : undefined
              return (
                <li key={app.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3">
                  <span className="min-w-0 break-words">
                    <Private className="font-medium">{app.name}</Private>
                    <span className={`block text-xs ${attention ? 'font-medium text-warning' : 'text-muted-foreground'}`}>
                      {project ? (
                        <>
                          <Private>{project.name}</Private>
                          {[
                            attention ? `key ${attention}` : 'connected',
                            project.lastSyncedAt ? `synced ${formatMoment(project.lastSyncedAt)}` : null,
                          ]
                            .filter(Boolean)
                            .map((part) => ` · ${part}`)
                            .join('')}
                        </>
                      ) : (
                        'No project connected'
                      )}
                    </span>
                  </span>
                  <Button asChild variant={project ? 'outline' : 'default'} size="sm">
                    <Link
                      to="/settings/apps/$appId"
                      params={{ appId: app.id }}
                      aria-label={`${project ? 'Settings' : 'Connect a project'} for ${app.name}`}
                    >
                      {project ? 'Settings' : 'Connect'}
                    </Link>
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </Section>

      {waiting.length > 0 && (
        <Section title="Not in an app">
          <p className="text-sm">
            <Private>{waiting.map((asset) => asset.name).join(', ')}</Private> {waiting.length === 1 ? 'is' : 'are'} connected
            but not part of an app.{' '}
            <Link to="/settings/apps" className="font-medium underline underline-offset-4">
              Link {waiting.length === 1 ? 'it' : 'them'} on the Apps page
            </Link>
            .
          </p>
        </Section>
      )}
    </SourcePage>
  )
}
