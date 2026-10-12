import { test as base, type Locator } from "@playwright/test";
import { Recorder } from "./recorder";
import { runInTerminal, type TerminalOptions, type TerminalResult } from "./terminal";
import { EVENTS_ATTACHMENT, isRecording, type ProofOptions } from "./types";

export interface FlowFixtures {
  proofOptions: ProofOptions;
  recorder: Recorder;
  /** A title card that opens a new part of the flow. */
  scene: (title: string, description?: string) => Promise<void>;
  /** A caption explaining what happens next. */
  say: (text: string) => Promise<void>;
  /** A real assertion whose result is shown on the video. */
  check: (claim: string, assertion: () => Promise<void>) => Promise<void>;
  /** Clears a field and types into it key by key, at reading speed when recording. */
  type: (target: Locator, text: string) => Promise<void>;
  /** Fills a field with a value that must stay off the video, such as a password. */
  typeSecret: (target: Locator, value: string) => Promise<void>;
  /** A wait that only happens on video. */
  pause: (ms: number) => Promise<void>;
  /** Runs a command and shows its output on the page: proof for a change with nothing to see in the product. */
  terminal: (command: string, args?: string[], options?: TerminalOptions) => Promise<TerminalResult>;
}

/**
 * A flow is a Playwright test with a narrator. Run it plainly and it is
 * an end-to-end test; run it with PROOF_RECORD=1 and the same steps
 * become a captioned video.
 */
export const flow = base.extend<FlowFixtures>({
  proofOptions: [{ captions: "top", allowedHosts: [], hideSelectors: [], terminalEnv: {}, secrets: [] }, { option: true }],

  recorder: [
    async ({ page, context, baseURL, proofOptions }, run, testInfo) => {
      const recorder = new Recorder(page, proofOptions, isRecording());
      await recorder.guard(context, baseURL);
      await recorder.start(testInfo.outputPath("clip.webm"));

      await run(recorder);

      const bodyPassed = testInfo.status === "passed" || testInfo.status === testInfo.expectedStatus;
      const payload = await recorder.finish(testInfo.title, bodyPassed);
      await testInfo.attach(EVENTS_ATTACHMENT, { body: JSON.stringify(payload), contentType: "application/json" });

      const failures = recorder.failures;
      if (bodyPassed && failures.length > 0) {
        throw new Error(
          [`${failures.length} proof failure(s):`, ...failures.map((event) => `  ✗ ${event.text}${event.detail ? `: ${event.detail}` : ""}`)].join(
            "\n",
          ),
        );
      }
    },
    { auto: true },
  ],

  scene: async ({ recorder }, run) => {
    await run((title, description) => recorder.scene(title, description));
  },
  say: async ({ recorder }, run) => {
    await run((text) => recorder.say(text));
  },
  check: async ({ recorder }, run) => {
    await run((claim, assertion) => recorder.check(claim, assertion));
  },
  pause: async ({ recorder }, run) => {
    await run((ms) => recorder.pause(ms));
  },
  type: async ({ recorder }, run) => {
    await run(async (target, text) => {
      await target.clear();
      await target.pressSequentially(text, { delay: recorder.recording ? 40 : 0 });
    });
  },
  typeSecret: async ({ recorder }, run) => {
    await run((target, value) => recorder.secret(target, value));
  },
  terminal: async ({ page, proofOptions }, run) => {
    // Whatever is still running when the flow ends (a timeout, a failure) is stopped with it.
    const ending = new AbortController();
    const defaults = { env: proofOptions.terminalEnv, secrets: proofOptions.secrets, signal: ending.signal };
    try {
      await run((command, args, options) => runInTerminal(page, command, args, options, defaults));
    } finally {
      ending.abort();
    }
  },
});

export { expect } from "@playwright/test";
