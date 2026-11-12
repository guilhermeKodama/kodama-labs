import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Node environment only, like the rest of the monorepo: pages and figures are
// pure server components, so tests render them with renderToStaticMarkup.
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['src/**/__tests__/**/*.test.{ts,tsx}'],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
});
