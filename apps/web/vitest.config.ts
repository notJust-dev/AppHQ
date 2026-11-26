import { defineConfig } from 'vitest/config'

// Unit tests of server code that needs no framework; the app's own Vite plugins stay out.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
})
