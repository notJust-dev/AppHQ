import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { nitro } from 'nitro/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  server: { host: '127.0.0.1', port: 3000 },
  // `@/` is `src/`, as tsconfig.json says; shadcn/ui components import through it.
  resolve: { tsconfigPaths: true },
  // tanstackStart must come before the React plugin; nitro builds the Node server in .output/.
  plugins: [tailwindcss(), tanstackStart(), nitro(), viteReact()],
})
