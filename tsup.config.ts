import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
    sourcemap: true,
    target: 'es2020',
    treeshake: true,
  },
  {
    entry: ['src/cli.ts'],
    format: ['esm'],
    clean: false,
    sourcemap: true,
    target: 'es2020',
    banner: { js: '#!/usr/bin/env node' },
  },
])
