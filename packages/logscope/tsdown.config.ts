import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/util.ts', 'src/util.node.ts', 'src/util.deno.ts'],
  dts: {
    sourcemap: true,
  },
  format: ['esm', 'cjs'],
  platform: 'neutral',
  unbundle: true,
})
