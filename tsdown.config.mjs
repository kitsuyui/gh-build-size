import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  platform: 'node',
  clean: true,
  dts: true,
  sourcemap: true,
  inlineOnly: false,
  noExternal: [/.*/],
})
