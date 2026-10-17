import { defineConfig } from "vitest/config";
import base from "./vitest.config";

// Isolated from the parallel suite. CI points DATABASE_URL at capital_fx_test
// for this config; locally it follows the same DATABASE_URL as the first run.
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ["src/server/modules/investments/services/__tests__/portfolio-fx-repair.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
  },
});
