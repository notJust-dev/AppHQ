import { sentryVitePlugin } from '@sentry/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { nitro } from 'nitro/vite'
import { defineConfig } from 'vite'

// Source maps for error reporting, only when SENTRY_AUTH_TOKEN is set at build time (with
// SENTRY_ORG and SENTRY_PROJECT): the build then makes hidden source maps, uploads them to Sentry
// and leaves them out of the output, so they are never served. Without the token the build is
// as before. See "Error reporting" in the README.
const uploadSourceMaps = Boolean(process.env.SENTRY_AUTH_TOKEN?.trim())

export default defineConfig({
  server: { host: '127.0.0.1', port: 3000 },
  // `@/` is `src/`, as tsconfig.json says; shadcn/ui components import through it.
  resolve: { tsconfigPaths: true },
  // tanstackStart must come before the React plugin; nitro builds the Node server in .output/.
  plugins: [
    tailwindcss(),
    tanstackStart(),
    nitro(),
    viteReact(),
    // Last, so it sees the final bundles. Browser bundles only: the server's errors are not sent
    // from its bundles, and its builds turn source maps off.
    ...sentryVitePlugin({
      disable: !uploadSourceMaps,
      // No reports about the plugin itself to Sentry.
      telemetry: false,
      sourcemaps: { deleteSourcemapsAfterUpload: true },
      // A failed upload (Sentry down, an expired token) only costs readable stack traces, so it
      // warns instead of failing the build and the deploy.
      errorHandler: (error) => console.warn(`Source maps were not uploaded to Sentry: ${error.message}`),
    }).map((plugin) => ({ ...plugin, applyToEnvironment: (environment: { name: string }) => environment.name === 'client' })),
  ],
})
