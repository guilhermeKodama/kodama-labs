import { defineConfig } from 'vitest/config';
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

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/__tests__/**/*.test.ts'],
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
