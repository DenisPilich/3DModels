import { defineConfig } from 'vite'

export default defineConfig({
  // Relative base keeps the demo working from GitHub Pages project URLs.
  base: './',
  build: {
    target: 'es2020',
    outDir: 'dist-demo',
    emptyOutDir: true,
  },
})
