import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  dts: {
    sourcemap: true,
  },
  format: ['esm', 'cjs'],
  platform: 'neutral',
  unbundle: true,
  external: ['logscope', 'hono'],
})
