import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { chromium } from "@playwright/test";
import type { FullConfig, FullResult, Reporter, TestCase, TestResult } from "@playwright/test/reporter";
import { EVENTS_ATTACHMENT, isRecording, type FlowPayload, type ProofEvent } from "./types";

const run = promisify(execFile);

export interface ReporterOptions {
  outDir: string;
  size: { width: number; height: number };
  meta: Record<string, string>;
  rerun?: string;
  maxVideoBytes?: number;
}

interface FlowRecord {
  title: string;
  file: string;
  status: TestResult["status"];
  /** Ran and ended the way it was expected to. A skipped flow is not ok: it proved nothing. */
  ok: boolean;
  payload: FlowPayload | null;
}

export interface ManifestEvent extends ProofEvent {
  /** Position in the final video, in milliseconds. */
  videoMs: number;
  /** Checks and problems only: the frame taken from the video at that moment. */
  frame?: string;
}

export interface Manifest {
  tool: string;
  recordedAt: string;
  commit: string | null;
  branch: string | null;
  /** True when the working tree had changes that are not in `commit`. */
  dirty: boolean;
  passed: boolean;
  checks: { passed: number; total: number };
  meta: Record<string, string>;
  video: { file: string; bytes: number; sha256: string; durationMs: number; overLimit: boolean } | null;
  flows: { title: string; file: string; status: string; passed: boolean; startMs: number; durationMs: number; events: ManifestEvent[] }[];
}

const FPS = 15;
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
// Tried in order until the video fits: each step roughly halves the size.
const QUALITY_STEPS = [28, 32, 36];
const CLOSING_MS = 3200;

function clock(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function length(ms: number): string {
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "check"
  );
}

function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

async function git(args: string[]): Promise<string | null> {
  try {
    return (await run("git", args)).stdout.trim();
  } catch {
    return null;
  }
}

async function durationMs(file: string): Promise<number> {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
  return Math.round(Number.parseFloat(stdout) * 1000);
}

async function requireFfmpeg(): Promise<void> {
  try {
    await run("ffmpeg", ["-version"]);
    await run("ffprobe", ["-version"]);
  } catch {
    throw new Error("proof-video needs ffmpeg and ffprobe on PATH to build the video (macOS: brew install ffmpeg).");
  }
}

/** The last seconds of the video: the verdict, and which commit it is about. */
async function recordClosingCard(file: string, size: ReporterOptions["size"], manifest: Manifest): Promise<void> {
  const color = manifest.passed ? "#0a7d33" : "#b42318";
  const commit = manifest.commit ? `${manifest.commit.slice(0, 9)}${manifest.dirty ? " + uncommitted changes" : ""}` : "no commit";
  const lines = [
    `${manifest.checks.passed} of ${manifest.checks.total} checks passed · ${manifest.flows.length} flow(s)`,
    `Commit ${commit}${manifest.branch ? ` · ${manifest.branch}` : ""}`,
    `Recorded ${manifest.recordedAt.slice(0, 16).replace("T", " ")} UTC`,
    ...Object.entries(manifest.meta).map(([key, value]) => `${key}: ${value}`),
  ];
  const html = `<!doctype html><html><body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#f6f7f9;font-family:system-ui,-apple-system,'Segoe UI',sans-serif">
    <div style="text-align:center">
      <div style="font-size:54px;font-weight:800;color:${color}">${manifest.passed ? "✓ Proof passed" : "✗ Proof failed"}</div>
      ${lines.map((line) => `<div style="font-size:21px;color:#333;margin-top:12px">${escapeHtml(line)}</div>`).join("")}
      <div style="margin:28px auto 0;width:240px;height:4px;background:#dfe3e8;border-radius:2px;overflow:hidden">
        <div style="height:100%;background:${color};animation:fill ${CLOSING_MS}ms linear forwards"></div>
      </div>
    </div>
    <style>@keyframes fill{from{width:0}to{width:100%}}</style>
  </body></html>`;

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: size });
    await page.setContent(html);
    await page.screencast.start({ path: file, size, fps: FPS });
    await page.waitForTimeout(CLOSING_MS);
    await page.screencast.stop();
  } finally {
    await browser.close();
  }
}

/** Joins the clips into one H.264 file every browser and GitHub can play. */
async function encode(clips: string[], target: string, size: ReporterOptions["size"], crf: number): Promise<void> {
  const { width, height } = size;
  const fit = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=white,setsar=1,fps=${FPS}`;
  const filter = [
    ...clips.map((_, index) => `[${index}:v]${fit}[v${index}]`),
    `${clips.map((_, index) => `[v${index}]`).join("")}concat=n=${clips.length}:v=1:a=0[out]`,
  ].join(";");
  await run(
    "ffmpeg",
    [
      "-y",
      "-v",
      "error",
      ...clips.flatMap((clip) => ["-i", clip]),
      "-filter_complex",
      filter,
      "-map",
      "[out]",
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      String(crf),
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-an",
      target,
    ],
    { maxBuffer: 16 * 1024 * 1024 },
  );
}

function prText(manifest: Manifest, options: ReporterOptions): string {
  const events = manifest.flows.flatMap((flow) => flow.events.map((event) => ({ flow: flow.title, ...event })));
  const scenes = events.filter((event) => event.kind === "scene");
  const checks = events.filter((event) => event.kind === "check");
  const problems = events.filter((event) => event.kind === "problem");
  const commit = manifest.commit ? `\`${manifest.commit.slice(0, 9)}\`${manifest.dirty ? " with uncommitted changes" : ""}` : "no commit";

  const lines = ["## Proof", ""];
  if (manifest.video) lines.push(`![Proof video](./${manifest.video.file})`, "");
  lines.push(
    [
      `**${manifest.passed ? "Passed" : "Failed"}**`,
      `${manifest.checks.passed} of ${manifest.checks.total} checks`,
      ...(manifest.video ? [length(manifest.video.durationMs)] : []),
      `recorded at ${commit} on ${manifest.recordedAt.slice(0, 10)}`,
      ...Object.entries(manifest.meta).map(([key, value]) => `${key} \`${value}\``),
    ].join(" · "),
    "",
  );
  if (manifest.video?.overLimit) {
    lines.push(`> The video is larger than the upload limit. Record fewer flows at a time.`, "");
  }
  if (scenes.length > 0) {
    lines.push("### What the video shows", "", "| At | Flow | Scene |", "|---|---|---|");
    for (const scene of scenes) lines.push(`| ${clock(scene.videoMs)} | ${cell(scene.flow)} | ${cell(scene.text)} |`);
    lines.push("");
  }
  if (checks.length > 0) {
    lines.push("### What it proves", "", "| At | Check | Result |", "|---|---|---|");
    for (const check of checks) {
      lines.push(`| ${clock(check.videoMs)} | ${cell(check.text)} | ${check.passed ? "✓" : `✗ ${cell(check.detail ?? "")}`} |`);
    }
    lines.push("");
  }
  const broken = manifest.flows.filter((flow) => !flow.passed);
  if (problems.length > 0 || broken.length > 0) {
    lines.push("### Problems", "");
    for (const problem of problems) lines.push(`- ${clock(problem.videoMs)} ${cell(problem.text)}`);
    for (const flow of broken) lines.push(`- Flow "${cell(flow.title)}" ${flow.status === "passed" ? "left no clip" : `ended as ${flow.status}`}`);
    lines.push("");
  }
  if (options.rerun) lines.push(`Record again: \`${options.rerun}\``, "");
  return lines.join("\n");
}

/**
 * Turns one run's clips into what a reviewer needs: `proof.mp4`, a
 * manifest, one frame per check, and the PR text. On a plain test run
 * (no recording) it writes nothing.
 */
export default class ProofReporter implements Reporter {
  private readonly flows: FlowRecord[] = [];
  private rootDir = process.cwd();

  constructor(private readonly options: ReporterOptions) {}

  printsToStdio(): boolean {
    return false;
  }

  onBegin(config: FullConfig): void {
    this.rootDir = config.rootDir;
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const attachment = result.attachments.find((item) => item.name === EVENTS_ATTACHMENT);
    let payload: FlowPayload | null = null;
    try {
      const body = attachment?.body ?? (attachment?.path ? fs.readFileSync(attachment.path) : null);
      if (body) payload = JSON.parse(body.toString("utf8")) as FlowPayload;
    } catch {
      payload = null;
    }
    this.flows.push({
      title: test.title,
      file: path.relative(this.rootDir, test.location.file),
      status: result.status,
      ok: test.outcome() === "expected" && result.status !== "skipped",
      payload,
    });
  }

  async onEnd(result: FullResult): Promise<{ status: FullResult["status"] } | undefined> {
    if (!isRecording()) return undefined;
    const { outDir, size } = this.options;
    const maxBytes = this.options.maxVideoBytes ?? DEFAULT_MAX_BYTES;
    const framesDir = path.join(outDir, "frames");
    for (const stale of ["proof.mp4", "FAILED-proof.mp4", "proof.json", "proof.md", "frames"]) {
      fs.rmSync(path.join(outDir, stale), { recursive: true, force: true });
    }
    fs.mkdirSync(framesDir, { recursive: true });
    await requireFfmpeg();

    const ran = this.flows;
    const allEvents = ran.flatMap((flow) => flow.payload?.events ?? []);
    const checks = allEvents.filter((event) => event.kind === "check");
    const manifest: Manifest = {
      tool: "@repo/proof-video",
      recordedAt: new Date().toISOString(),
      commit: await git(["rev-parse", "HEAD"]),
      branch: await git(["rev-parse", "--abbrev-ref", "HEAD"]),
      dirty: ((await git(["status", "--porcelain"])) ?? "") !== "",
      // Settled below, once it is known which flows left a clip.
      passed: false,
      checks: { passed: checks.filter((event) => event.passed).length, total: checks.length },
      meta: this.options.meta,
      video: null,
      flows: [],
    };

    // Where each flow starts in the final video, and where its events land.
    const clips: string[] = [];
    let cursor = 0;
    for (const flow of ran) {
      const clip = flow.payload?.clip && fs.existsSync(flow.payload.clip) ? flow.payload.clip : null;
      const clipMs = clip ? await durationMs(clip) : 0;
      // The clip starts with its first frame, a moment after recording was asked for.
      const lead = flow.payload && clip ? Math.min(2000, Math.max(0, flow.payload.wallMs - clipMs)) : 0;
      manifest.flows.push({
        title: flow.title,
        file: flow.file,
        status: flow.status,
        // A flow with no clip is missing from the video, whatever its result.
        passed: flow.ok && clip !== null,
        startMs: cursor,
        durationMs: clipMs,
        events: (flow.payload?.events ?? []).map((event) => ({
          ...event,
          videoMs: cursor + Math.min(Math.max(0, event.atMs - lead), Math.max(0, clipMs - 1)),
        })),
      });
      if (clip) clips.push(clip);
      cursor += clipMs;
    }
    manifest.passed = result.status === "passed" && manifest.flows.length > 0 && manifest.flows.every((flow) => flow.passed);

    if (clips.length > 0) {
      const closing = path.join(outDir, "runs", "closing.webm");
      fs.mkdirSync(path.dirname(closing), { recursive: true });
      await recordClosingCard(closing, size, manifest);
      const name = manifest.passed ? "proof.mp4" : "FAILED-proof.mp4";
      const target = path.join(outDir, name);
      for (const crf of QUALITY_STEPS) {
        await encode([...clips, closing], target, size, crf);
        if (fs.statSync(target).size <= maxBytes) break;
      }
      const bytes = fs.statSync(target).size;
      manifest.video = {
        file: name,
        bytes,
        sha256: createHash("sha256").update(fs.readFileSync(target)).digest("hex"),
        durationMs: await durationMs(target),
        overLimit: bytes > maxBytes,
      };

      // One frame per check, taken from the finished video: what the reviewer will see.
      let index = 0;
      for (const flow of manifest.flows) {
        for (const event of flow.events) {
          if (event.kind !== "check" && event.kind !== "problem") continue;
          index += 1;
          const at = Math.min(event.videoMs + 400, manifest.video.durationMs - 100);
          const frame = `${String(index).padStart(2, "0")}-${clock(at).replace(":", "m")}s-${event.passed === false || event.kind === "problem" ? "FAILED-" : ""}${slug(event.text)}.jpg`;
          await run("ffmpeg", ["-y", "-v", "error", "-ss", (at / 1000).toFixed(2), "-i", target, "-frames:v", "1", "-q:v", "3", path.join(framesDir, frame)]);
          event.frame = `frames/${frame}`;
        }
      }
    }

    fs.writeFileSync(path.join(outDir, "proof.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    fs.writeFileSync(path.join(outDir, "proof.md"), prText(manifest, this.options));

    const where = path.relative(process.cwd(), outDir) || ".";
    const summary = [
      "",
      `Proof ${manifest.passed ? "passed" : "FAILED"}: ${manifest.checks.passed} of ${manifest.checks.total} checks.`,
      ...(manifest.video
        ? [`  video     ${where}/${manifest.video.file} (${(manifest.video.bytes / 1024 / 1024).toFixed(1)} MB, ${length(manifest.video.durationMs)})`]
        : ["  video     none: no flow produced a clip"]),
      `  frames    ${where}/frames/  <- open these before attaching the video`,
      `  PR text   ${where}/proof.md`,
      `  manifest  ${where}/proof.json`,
      ...(manifest.video?.overLimit ? ["  The video is over the upload limit: record fewer flows at a time."] : []),
      "",
    ];
    process.stdout.write(`${summary.join("\n")}\n`);
    // A skipped flow or a missing clip fails the run even when every test that ran passed.
    return manifest.passed ? undefined : { status: "failed" };
  }
}
