import { describe, expect, it } from "vitest";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import cron from "node-cron";
import { CRON_APPS, readScheduleFile, scheduleFilePath } from "./schedules";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

function routeFileFor(appName: string, cronPath: string): string {
  const relativePath = cronPath.replace(/^\//, "");
  return join(repoRoot, "apps", appName, "src/app", relativePath, "route.ts");
}

describe("cron schedules", () => {
  it("covers capital and sentinel", () => {
    expect(CRON_APPS.map((app) => app.name)).toEqual(["capital", "sentinel"]);
  });

  for (const app of CRON_APPS) {
    it(`${app.name} schedules are valid and each path has a route`, () => {
      const filePath = scheduleFilePath(app.scheduleFile);
      const { crons } = readScheduleFile(filePath);

      expect(crons.length).toBeGreaterThan(0);

      const paths = crons.map((job) => job.path);
      expect(new Set(paths).size).toBe(paths.length);

      for (const job of crons) {
        expect(job.path.startsWith("/api/cron/"), job.path).toBe(true);
        expect(cron.validate(job.schedule), `${job.path} ${job.schedule}`).toBe(true);
        const routeFile = routeFileFor(app.name, job.path);
        expect(existsSync(routeFile), routeFile).toBe(true);
      }
    });
  }
});
