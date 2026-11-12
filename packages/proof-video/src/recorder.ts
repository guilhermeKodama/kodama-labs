import fs from "node:fs";
import path from "node:path";
import type { BrowserContext, Locator, Page } from "@playwright/test";
import type { FlowPayload, ProofEvent, ProofOptions } from "./types";

interface Disposable {
  dispose(): Promise<void>;
}

const FPS = 15;
const CHAPTER_MS = 1600;
const PASS_HOLD_MS = 1300;
const FAIL_HOLD_MS = 2600;
const END_HOLD_MS = 1800;

const POINT_STYLE =
  "width:18px;height:18px;border-radius:50%;background:rgba(255,96,0,.6);box-shadow:0 0 0 7px rgba(255,96,0,.2)";
const HIGHLIGHT_STYLE =
  "outline:2px solid rgba(255,120,0,.95);outline-offset:2px;border-radius:6px;background:rgba(255,160,0,.1)";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

/** An error in one line: what failed, and what was expected against what was found when the error says so. */
function summary(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  // Playwright colours its assertion messages for the terminal.
  // eslint-disable-next-line no-control-regex
  const lines = message.replace(/\u001b\[[0-9;]*m/g, "").split("\n").map((line) => line.trim());
  const detail = lines.filter((line) => /^(Expected|Received)\b/.test(line)).map((line) => line.replace(/\s+/g, " "));
  return [lines[0] ?? "", ...detail].filter(Boolean).join(" · ").slice(0, 300);
}

/** How long a caption needs to be read. */
function readingMs(text: string): number {
  return Math.min(5000, Math.max(1400, 700 + text.length * 45));
}

function banner(text: string, background: string, edge: ProofOptions["captions"]): string {
  // Tight against the edge and narrow, so it covers as little of the app as it can.
  return [
    `<div style="position:fixed;${edge}:5px;left:50%;transform:translateX(-50%);width:max-content;max-width:52%;`,
    `background:${background};color:#fff;padding:7px 16px;border-radius:10px;`,
    `font:600 18px/1.3 system-ui,-apple-system,'Segoe UI',sans-serif;text-align:center;`,
    `box-shadow:0 4px 18px rgba(0,0,0,.28)">${escapeHtml(text)}</div>`,
  ].join("");
}

function endCard(passed: boolean, title: string, summary: string): string {
  const color = passed ? "#0a7d33" : "#b42318";
  return [
    `<div style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(15,15,20,.55)">`,
    `<div style="background:#fff;border-radius:16px;padding:28px 40px;text-align:center;max-width:70%;`,
    `font-family:system-ui,-apple-system,'Segoe UI',sans-serif;box-shadow:0 12px 48px rgba(0,0,0,.35)">`,
    `<div style="font-size:30px;font-weight:700;color:${color}">${passed ? "✓ Passed" : "✗ Failed"}</div>`,
    `<div style="font-size:19px;font-weight:600;color:#111;margin-top:8px">${escapeHtml(title)}</div>`,
    `<div style="font-size:16px;color:#555;margin-top:6px">${escapeHtml(summary)}</div>`,
    `</div></div>`,
  ].join("");
}

/**
 * Records one flow: the clip, the captions on it, and the list of scenes
 * and checks with the moment each one happened. With recording off it
 * keeps the same list and skips every wait, so the flow runs as a plain
 * end-to-end test.
 */
export class Recorder {
  readonly events: ProofEvent[] = [];
  private startedAt = Date.now();
  private caption: Disposable | null = null;
  private clip: string | null = null;
  private readonly secretFields: Locator[] = [];

  constructor(
    private readonly page: Page,
    private readonly options: ProofOptions,
    readonly recording: boolean,
    /** Where the full-resolution screenshots of the checks go, when recording. */
    private readonly shotDir: string | null = null,
  ) {}

  get failures(): ProofEvent[] {
    return this.events.filter((event) => event.kind === "problem" || (event.kind === "check" && event.passed === false));
  }

  private at(): number {
    return Date.now() - this.startedAt;
  }

  /** Block every host that is not the app's, and fail the flow on errors the user would not see. */
  async guard(context: BrowserContext, baseURL: string | undefined): Promise<void> {
    const allowed = new Set([...LOCAL_HOSTS, ...this.options.allowedHosts]);
    if (baseURL) allowed.add(new URL(baseURL).hostname);
    const isForeign = (url: URL) => /^https?:$/.test(url.protocol) && !allowed.has(url.hostname) && !url.hostname.endsWith(".localhost");

    await context.route(isForeign, async (route) => {
      this.problem(`Blocked a call to ${new URL(route.request().url()).host}`);
      await route.abort();
    });
    this.page.on("pageerror", (error) => this.problem(`Page error: ${summary(error)}`));
    this.page.on("response", (response) => {
      if (response.status() < 500) return;
      const url = new URL(response.url());
      if (isForeign(url)) return;
      this.problem(`${response.status()} from ${response.request().method()} ${url.pathname}`);
    });

    if (this.options.hideSelectors.length > 0) {
      const css = `${this.options.hideSelectors.join(",")}{display:none !important}`;
      await context.addInitScript((text) => {
        const add = () => {
          const style = document.createElement("style");
          style.textContent = text;
          (document.head ?? document.documentElement).appendChild(style);
        };
        if (document.head) add();
        else document.addEventListener("DOMContentLoaded", add);
      }, css);
    }
  }

  async start(clip: string): Promise<void> {
    if (this.recording) {
      const size = this.page.viewportSize() ?? { width: 1280, height: 720 };
      await this.page.screencast.start({ path: clip, size, fps: FPS });
      await this.showActions();
      this.clip = clip;
    }
    this.startedAt = Date.now();
  }

  /**
   * A pointer that travels to each target and a ring on the target. The
   * action title is hidden: it prints the locator and whatever was typed,
   * which is noise at best and a leaked password at worst.
   */
  private async showActions(): Promise<void> {
    await this.page.screencast.showActions({
      duration: 450,
      style: { point: POINT_STYLE, highlight: HIGHLIGHT_STYLE, title: "display:none !important" },
    });
  }

  /**
   * Fills a field with a value that must not be shown. Action marks are
   * off while it happens, and an error from the fill is rethrown without
   * the value, which Playwright would otherwise quote in its call log.
   */
  async secret(target: Locator, value: string): Promise<void> {
    if (this.recording) await this.page.screencast.hideActions();
    this.secretFields.push(target);
    try {
      await target.fill(value);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(value ? message.split(value).join("***") : message);
    } finally {
      if (this.recording) await this.showActions();
    }
  }

  /**
   * Empties the fields `secret` filled. After a failure Playwright saves
   * a snapshot of the page that includes the value of password fields;
   * a sign-in that failed would leave the password in it.
   */
  private async forgetSecrets(): Promise<void> {
    for (const target of this.secretFields) {
      await target
        .evaluateAll((elements) => {
          for (const element of elements) {
            if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) element.value = "";
          }
        })
        .catch(() => undefined);
    }
  }

  private async clearCaption(): Promise<void> {
    const caption = this.caption;
    this.caption = null;
    await caption?.dispose().catch(() => undefined);
  }

  private async show(html: string, holdMs: number, keep: boolean): Promise<void> {
    if (!this.recording) return;
    await this.clearCaption();
    const overlay = await this.page.screencast.showOverlay(html, keep ? undefined : { duration: holdMs });
    if (keep) this.caption = overlay;
    await this.page.waitForTimeout(holdMs);
  }

  /** A title card: the start of a new part of the flow. */
  async scene(title: string, description?: string): Promise<void> {
    this.events.push({ kind: "scene", text: title, atMs: this.at(), detail: description });
    if (!this.recording) return;
    await this.clearCaption();
    await this.page.screencast.showChapter(title, { description, duration: CHAPTER_MS });
  }

  /** A caption that stays up until the next caption, scene or check. */
  async say(text: string): Promise<void> {
    this.events.push({ kind: "say", text, atMs: this.at() });
    await this.show(banner(text, "rgba(17,17,24,.92)", this.options.captions), readingMs(text), true);
  }

  /**
   * Runs a real assertion and puts the result on the video. A failed
   * check does not stop the flow: the recording goes on to the end so the
   * video shows what happened, and the flow fails when it finishes.
   */
  async check(claim: string, assertion: () => Promise<void>): Promise<void> {
    let detail: string | undefined;
    try {
      await assertion();
    } catch (error) {
      detail = summary(error) || "The check failed";
    }
    const passed = detail === undefined;
    const shot = await this.screenshot();
    this.events.push({ kind: "check", text: claim, atMs: this.at(), passed, detail, shot });
    await this.show(
      banner(`${passed ? "✓" : "✗"} ${claim}`, passed ? "#0a7d33" : "#b42318", this.options.captions),
      passed ? PASS_HOLD_MS : FAIL_HOLD_MS,
      false,
    );
  }

  /**
   * The page as the check left it, at the context's full pixel density and
   * without the banner: the screenshot a reviewer zooms into, where a frame
   * of the compressed video would blur. Only when recording.
   */
  private async screenshot(): Promise<string | undefined> {
    if (!this.recording || !this.shotDir || this.page.isClosed()) return undefined;
    fs.mkdirSync(this.shotDir, { recursive: true });
    const file = path.join(this.shotDir, `${this.events.filter((event) => event.kind === "check").length + 1}.png`);
    // The caption would cover the product, and the pointer too: the check banner replaces the caption next anyway.
    await this.clearCaption();
    await this.page.screencast.hideActions().catch(() => undefined);
    try {
      await this.page.screenshot({ path: file, type: "png" });
      return file;
    } catch {
      return undefined;
    } finally {
      await this.showActions().catch(() => undefined);
    }
  }

  /** Something went wrong that no check was watching for. */
  problem(text: string): void {
    // One slow endpoint can fail on every poll; one line is enough.
    if (this.events.some((event) => event.kind === "problem" && event.text === text)) return;
    this.events.push({ kind: "problem", text, atMs: this.at() });
    if (!this.recording) return;
    void this.page.screencast
      .showOverlay(banner(`✗ ${text}`, "#b42318", this.options.captions === "top" ? "bottom" : "top"), { duration: FAIL_HOLD_MS })
      .catch(() => undefined);
  }

  /** A wait that exists only on video, to let the viewer take in a state. */
  async pause(ms: number): Promise<void> {
    if (this.recording) await this.page.waitForTimeout(ms);
  }

  async finish(title: string, bodyPassed: boolean): Promise<FlowPayload> {
    if (!this.page.isClosed()) await this.forgetSecrets();
    const checks = this.events.filter((event) => event.kind === "check");
    // A flow that checks nothing is a tour, and must not come out green.
    if (bodyPassed && checks.length === 0) this.events.push({ kind: "problem", text: "The flow made no check, so it proves nothing", atMs: this.at() });
    const passed = bodyPassed && this.failures.length === 0;
    if (this.recording && this.clip && !this.page.isClosed()) {
      const summary =
        checks.length > 0 ? `${checks.filter((event) => event.passed).length} of ${checks.length} checks passed` : "No checks ran";
      try {
        await this.clearCaption();
        await this.page.screencast.showOverlay(endCard(passed, title, summary), { duration: END_HOLD_MS });
        await this.page.waitForTimeout(END_HOLD_MS);
      } catch {
        // The page may be gone after a crash; the clip still gets saved.
      }
    }
    const wallMs = this.at();
    if (this.recording && this.clip) {
      // A clip that could not be saved is reported as missing, not passed over.
      await this.page.screencast.stop().catch(() => {
        this.clip = null;
      });
    }
    return { recording: this.recording, clip: this.clip, wallMs, events: this.events };
  }
}
