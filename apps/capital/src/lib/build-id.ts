import { readFileSync } from "node:fs";
import { join } from "node:path";

// Next writes .next/BUILD_ID once per `next build` — a fresh id every deploy,
// which is exactly the "did the content actually change" signal /sw.js needs
// to trigger the browser's byte-diff update check. `next dev` never writes
// this file, hence the fallback.
let cached: string | undefined;

export function getBuildId(): string {
  if (!cached) {
    try {
      cached = readFileSync(join(process.cwd(), ".next", "BUILD_ID"), "utf8").trim();
    } catch {
      cached = "dev";
    }
  }
  return cached;
}
