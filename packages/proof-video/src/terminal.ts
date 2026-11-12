import { spawn } from "node:child_process";
import type { Page } from "@playwright/test";

export interface TerminalOptions {
  cwd?: string;
  /** Extra variables for the command, on top of the project's `proof.terminalEnv`. */
  env?: Record<string, string>;
  /** Extra strings that must never appear on screen. */
  mask?: string[];
  /** Kill the command after this long. Default: one minute, which fits inside a flow's own time limit. */
  timeoutMs?: number;
}

export interface TerminalResult {
  code: number;
  /** What was shown on screen, secrets already masked. */
  output: string;
}

/** What the project sets once for every `terminal()` call. */
export interface TerminalDefaults {
  env: Record<string, string>;
  secrets: string[];
  /** Aborted when the flow ends, so a command never outlives it. */
  signal?: AbortSignal;
}

const SECRET_NAME = /SECRET|TOKEN|PASS|CREDENTIAL|PRIVATE|SESSION|COOKIE|API_KEY|_KEY$|DATABASE_URL|DIRECT_URL|_URI$|DSN/i;
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007/g;
// The login part of a URL, with or without a password: scheme://user:pass@ and scheme://token@.
const URL_CREDENTIALS = /([a-z][a-z0-9+.-]*:\/\/)[^\s@/]+@/gi;

const TERMINAL_PAGE = `<!doctype html>
<html data-proof-terminal="1">
  <body style="margin:0;background:#0d1117;color:#e6edf3">
    <pre id="out" style="margin:0;padding:64px 28px 28px;height:100vh;box-sizing:border-box;overflow:auto;white-space:pre-wrap;word-break:break-word;font:15px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace"></pre>
  </body>
</html>`;

const LINE_COLORS = { command: "#79c0ff", output: "#e6edf3", ok: "#3fb950", bad: "#f85149" } as const;

/**
 * Builds the function that hides secrets: the values of secret-looking
 * variables, the login part of any URL, and every string passed in. It
 * only knows the values it is given: a secret the command reads from a
 * file of its own stays visible unless the project lists it.
 */
export function masker(env: Record<string, string | undefined>, extra: string[] = []): (text: string) => string {
  const values = Object.entries(env)
    .filter(([name, value]) => SECRET_NAME.test(name) && value !== undefined && value.length >= 6)
    .map(([, value]) => value as string)
    .concat(extra.filter((value) => value.length > 0))
    // Longest first, so a secret that contains another is replaced whole.
    .sort((a, b) => b.length - a.length);
  return (text) => {
    let masked = text;
    for (const value of values) masked = masked.split(value).join("***");
    return masked.replace(URL_CREDENTIALS, "$1***@");
  };
}

async function print(page: Page, text: string, color: string): Promise<void> {
  await page.evaluate(
    ([line, lineColor]) => {
      const out = document.getElementById("out");
      if (!out) return;
      const span = document.createElement("span");
      span.style.color = lineColor as string;
      // textContent, never innerHTML: command output is not markup.
      span.textContent = line as string;
      out.appendChild(span);
      out.scrollTop = out.scrollHeight;
    },
    [text, color],
  );
}

/**
 * Runs a real command and shows its output and exit code on the page, so
 * a change with nothing to see in the product can still be recorded.
 */
export async function runInTerminal(
  page: Page,
  command: string,
  args: string[] = [],
  options: TerminalOptions = {},
  defaults: TerminalDefaults = { env: {}, secrets: [] },
): Promise<TerminalResult> {
  const onTerminal = await page.evaluate(() => document.documentElement.dataset.proofTerminal === "1").catch(() => false);
  if (!onTerminal) await page.setContent(TERMINAL_PAGE);

  const env = { ...process.env, ...defaults.env, ...options.env, NO_COLOR: "1", FORCE_COLOR: "0" };
  const mask = masker(env, [...defaults.secrets, ...(options.mask ?? [])]);
  await print(page, `$ ${mask([command, ...args].join(" "))}\n`, LINE_COLORS.command);

  // Its own process group, so stopping it also stops what it started
  // (a package script is several processes deep).
  const child = spawn(command, args, { cwd: options.cwd, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
  const stop = () => {
    if (child.pid === undefined || child.exitCode !== null) return;
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  };
  defaults.signal?.addEventListener("abort", stop, { once: true });

  let output = "";
  let buffer = "";
  // Lines are printed one after another, in the order they arrived.
  let printing: Promise<void> = Promise.resolve();
  const flush = (text: string) => {
    if (!text) return;
    const clean = mask(text.replace(ANSI, "").replace(/\r(?!\n)/g, "\n"));
    output += clean;
    printing = printing.then(() => print(page, clean, LINE_COLORS.output)).catch(() => undefined);
  };
  const onData = (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    // Whole lines only: a secret split across two chunks would slip past the mask.
    const end = buffer.lastIndexOf("\n");
    if (end === -1) return;
    flush(buffer.slice(0, end + 1));
    buffer = buffer.slice(end + 1);
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);

  const timeoutMs = options.timeoutMs ?? 60_000;
  try {
    const code = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => {
        stop();
        reject(new Error(`"${command}" did not finish in ${Math.round(timeoutMs / 1000)}s`));
      }, timeoutMs);
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on("close", (exit) => {
        clearTimeout(timer);
        resolve(exit ?? 1);
      });
    });
    flush(buffer.endsWith("\n") || buffer === "" ? buffer : `${buffer}\n`);
    await printing;
    await print(page, `exit code ${code}\n\n`, code === 0 ? LINE_COLORS.ok : LINE_COLORS.bad);
    return { code, output };
  } finally {
    defaults.signal?.removeEventListener("abort", stop);
  }
}
