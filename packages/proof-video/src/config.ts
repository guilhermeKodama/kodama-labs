import path from "node:path";
import { defineConfig, type PlaywrightTestConfig } from "@playwright/test";
import type { ReporterOptions } from "./reporter";
import { isRecording, type ProofOptions } from "./types";

/** The option the flows read, as Playwright's `use` sees it. */
interface ProofUse {
  proofOptions: ProofOptions;
}

type Use = NonNullable<PlaywrightTestConfig<ProofUse>["use"]>;

export interface ProofConfig {
  /** The app's proof folder: flows live in `<dir>/flows`, one-off proofs in `<dir>/once`, the validation-package tour in `<dir>/package`, results in `<dir>/out`. */
  dir: string;
  /** Where results go when `<dir>/out` is shared, e.g. one folder per agent recording in parallel. */
  outDir?: string;
  baseURL: string;
  /** How Playwright starts the app, or attaches to one already running. */
  webServer?: PlaywrightTestConfig["webServer"];
  /** Runs once before the flows: database, seed, login. */
  globalSetup?: string;
  globalTeardown?: string;
  /** Saved session, so flows start signed in. */
  storageState?: string;
  locale?: string;
  timezoneId?: string;
  viewport?: { width: number; height: number };
  /**
   * Pixel density of the page, which sets the resolution of the screenshot
   * taken at each check (2 = a retina screenshot, twice the viewport). The
   * video keeps the viewport size. Default: 2.
   */
  deviceScaleFactor?: number;
  proof?: Partial<ProofOptions>;
  /** Shown in the manifest and the PR text, e.g. which database was used. */
  meta?: Record<string, string>;
  /** The command that records again, printed in the PR text. */
  rerun?: string;
  /** Largest video the PR host accepts. Default: 10 MB. */
  maxVideoBytes?: number;
  /** Anything else for Playwright's `use`. */
  use?: Use;
}

/**
 * Playwright settings every proof run shares: one worker and no retries,
 * so the video is one take in a known order; Playwright's own video and
 * trace off, because the recorder makes the clip and a trace would keep
 * typed secrets.
 */
/** Which suite of `<dir>` this run plays: PROOF_ONCE=1 picks `once`, PROOF_PACKAGE=1 `package`. */
export function proofSuite(): "flows" | "once" | "package" {
  if (process.env.PROOF_ONCE === "1") return "once";
  if (process.env.PROOF_PACKAGE === "1") return "package";
  return "flows";
}

export function defineProofConfig(config: ProofConfig): PlaywrightTestConfig<ProofUse> {
  const recording = isRecording();
  // `flows/` is the suite that always runs. `once/` holds proofs of a
  // single change (a migration, a script) that cannot be replayed later.
  // `package/` is the validation-package: a tour of every screen of the
  // app, recorded at the end of a piece of work. The last two run only
  // when asked for, and keep their results apart.
  const suite = proofSuite();
  const outDir = path.join(config.outDir ?? path.join(config.dir, "out"), ...(suite === "flows" ? [] : [suite]));
  const reporterOptions: ReporterOptions = {
    outDir,
    size: config.viewport ?? { width: 1280, height: 720 },
    meta: config.meta ?? {},
    rerun: config.rerun,
    maxVideoBytes: config.maxVideoBytes,
  };

  return defineConfig<ProofUse>({
    testDir: path.join(config.dir, suite),
    testMatch: "**/*.flow.ts",
    outputDir: path.join(outDir, "runs"),
    workers: 1,
    fullyParallel: false,
    retries: 0,
    forbidOnly: !!process.env.CI,
    // Captions and title cards add minutes to a recorded run.
    timeout: recording ? 300_000 : 90_000,
    expect: { timeout: 10_000 },
    reporter: [["list"], [path.join(__dirname, "reporter.ts"), reporterOptions]],
    globalSetup: config.globalSetup,
    globalTeardown: config.globalTeardown,
    webServer: config.webServer,
    use: {
      baseURL: config.baseURL,
      viewport: reporterOptions.size,
      deviceScaleFactor: config.deviceScaleFactor ?? 2,
      storageState: config.storageState,
      locale: config.locale,
      timezoneId: config.timezoneId,
      actionTimeout: 15_000,
      navigationTimeout: 45_000,
      // A service worker can serve stale pages and hides requests from the host guard.
      serviceWorkers: "block",
      trace: "off",
      video: "off",
      screenshot: "off",
      proofOptions: { captions: "top", allowedHosts: [], hideSelectors: [], terminalEnv: {}, secrets: [], ...config.proof },
      ...config.use,
    },
  });
}
