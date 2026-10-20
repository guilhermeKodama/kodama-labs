import { defineConfig } from 'vitest/config';
import fs from 'node:fs';
import os from 'node:os';
import path from 'path';

// Vitest does not read .env on its own. Without this, DATABASE_URL is
// unset and anything touching Prisma used to fall through to env.ts's
// old production default - tests silently reading and writing the real
// database. Load the app's own .env so tests hit capital_dev; if it is
// missing, env.ts now throws instead of guessing.
try {
  process.loadEnvFile(path.resolve(__dirname, '.env'));
} catch {
  // No .env (fresh worktree / CI) - let env.ts report what's missing.
}

// .env points CAPITAL_BLOB_DIR at a developer home directory. Tests always
// write to a temp dir instead.
const testBlobDir = path.join(os.tmpdir(), 'capital-vitest-blob');
fs.mkdirSync(testBlobDir, { recursive: true });
process.env.CAPITAL_BLOB_DIR = testBlobDir;

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/__tests__/**/*.test.ts'],
    // portfolio-fx-repair.test.ts applies a migration that rewrites rows
    // across the database. It flakes when other files run in parallel, so
    // the package test script runs it afterwards via vitest.fx.config.ts.
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/cypress/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*',
      '**/portfolio-fx-repair.test.ts',
    ],
    // Hard-fails the run before any test body executes if DATABASE_URL
    // does not point at a dev/test database. See src/test/db-guard.setup.ts.
    setupFiles: ['src/test/db-guard.setup.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@capital/server': path.resolve(__dirname, './src/server'),
    },
  },
});
