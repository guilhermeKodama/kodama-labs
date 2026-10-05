import type { Readable } from "node:stream";
import { createDocker, toListed, type ListedContainer } from "./docker.js";
import { demuxDockerFrames } from "./docker-frames.js";
import { detectKinds, type Kind } from "./detect.js";
import { compileIgnore, ignoreSourcesFromEnv, isIgnored } from "./ignore.js";
import {
  attachLogFollow,
  containersToFollow,
  forgetMeta,
  pruneContainerMaps,
} from "./log-follow.js";
import { RateLimiter } from "./rate-limit.js";
import { redact } from "./redact.js";
import { signatureOf } from "./signature.js";
import { idleForever } from "./idle.js";
import { postJson, webhookFromProcess } from "./webhook.js";

const QUIET_MS = 15_000;
const SUPPRESS_MS = 30 * 60_000;

interface Meta {
  service: string;
  container: string;
  kinds: string[];
  signature: string;
  signatureHash: string;
  alert: "error-spike" | "monitor-down" | "migration-failed";
}

async function main(): Promise<void> {
  const webhook = webhookFromProcess();
  if (!webhook) {
    console.log("[log-watcher] ALERT_WEBHOOK_URL unset; idling");
    await idleForever();
    return;
  }

  const patterns = compileIgnore(ignoreSourcesFromEnv(process.env.LOG_WATCH_IGNORE));
  const project = process.env.COMPOSE_PROJECT_NAME?.trim() || "kodama-prod";
  const host = process.env.WATCH_HOST?.trim() || "kodama-ai";
  const docker = createDocker();
  const limiter = new RateLimiter(QUIET_MS, SUPPRESS_MS);
  const meta = new Map<string, Meta>();
  const following = new Map<string, Readable>();
  const starting = new Set<string>();
  const restartCounts = new Map<string, number>();
  const migrateSeen = new Set<string>();
  let primed = false;

  const note = (key: string, info: Meta, excerpt: string): void => {
    if (!meta.has(key)) meta.set(key, info);
    limiter.observe(key, Date.now(), excerpt);
  };

  const onChunk = (container: ListedContainer, text: string): void => {
    if (isIgnored(text, patterns)) return;
    const kinds = detectKinds(text);
    if (kinds.length === 0) return;
    const signature = signatureOf(text);
    const key = `${container.service}:${signature.hash}`;
    note(
      key,
      {
        service: container.service,
        container: container.name,
        kinds,
        signature: signature.signature,
        signatureHash: signature.hash,
        alert: kinds.includes("migration") ? "migration-failed" : "error-spike",
      },
      redact(text),
    );
  };

  const tick = async (): Promise<void> => {
    const listed = (await docker.listContainers({
      all: true,
      filters: { label: [`com.docker.compose.project=${project}`] },
    })).map((item) => toListed(item));

    const known = new Set(listed.map((item) => item.Id));
    for (const [id, stream] of following) {
      if (known.has(id)) continue;
      stream.destroy();
      following.delete(id);
    }
    pruneContainerMaps(known, restartCounts, migrateSeen);
    const toFollow = new Set(containersToFollow(listed, following, starting).map((item) => item.Id));

    for (const container of listed) {
      if (container.service === "uptime-kuma" && primed && container.State !== "running") {
        note(
          "uptime-kuma:down",
          {
            service: "uptime-kuma",
            container: container.name,
            kinds: ["monitor-down"],
            signature: "uptime-kuma is not running",
            signatureHash: "sha256:uptime-kuma-down",
            alert: "monitor-down",
          },
          "uptime-kuma is not running",
        );
      }

      if (toFollow.has(container.Id)) {
        starting.add(container.Id);
        void follow(docker, container, following, onChunk).then(
          () => {
            starting.delete(container.Id);
          },
          (error: unknown) => {
            starting.delete(container.Id);
            console.error(
              `[log-watcher] follow ${container.service} failed:`,
              error instanceof Error ? error.message : error,
            );
          },
        );
      }

      if (!primed) continue;
      await inspectContainer(docker, container, restartCounts, migrateSeen, note);
    }

    if (!primed) {
      for (const container of listed) {
        await rememberBaseline(docker, container, restartCounts, migrateSeen);
      }
      primed = true;
    }

    const now = Date.now();
    for (const due of limiter.collect(now)) {
      const info = meta.get(due.key);
      if (!info) continue;
      await postJson(webhook, {
        source: "kodama-log-watcher",
        version: 1,
        alert: info.alert,
        severity: "error",
        service: info.service,
        container: info.container,
        kinds: info.kinds,
        signature: info.signature,
        signatureHash: info.signatureHash,
        count: due.count,
        windowStart: new Date(due.windowStart).toISOString(),
        windowEnd: new Date(due.windowEnd).toISOString(),
        excerpt: due.excerpt,
        host,
      });
    }
    forgetMeta(meta, limiter.drainExpired());
  };

  for (;;) {
    try {
      await tick();
    } catch (error) {
      console.error("[log-watcher]", error instanceof Error ? error.message : error);
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

async function follow(
  docker: ReturnType<typeof createDocker>,
  container: ListedContainer,
  following: Map<string, Readable>,
  onChunk: (container: ListedContainer, text: string) => void,
): Promise<void> {
  const since = Math.floor(Date.now() / 1000);
  const stream: unknown = await docker.getContainer(container.Id).logs({
    follow: true,
    stdout: true,
    stderr: true,
    tail: 0,
    since,
  });
  if (!isReadable(stream)) return;
  attachLogFollow({ stream, container, following, onChunk });
}

async function rememberBaseline(
  docker: ReturnType<typeof createDocker>,
  container: ListedContainer,
  restartCounts: Map<string, number>,
  migrateSeen: Set<string>,
): Promise<void> {
  const state = await readState(docker, container.Id);
  if (!state) return;
  restartCounts.set(container.Id, state.RestartCount ?? 0);
  if (container.service.endsWith("-migrate") && state.FinishedAt) {
    migrateSeen.add(`${container.Id}:${state.FinishedAt}`);
  }
}

async function inspectContainer(
  docker: ReturnType<typeof createDocker>,
  container: ListedContainer,
  restartCounts: Map<string, number>,
  migrateSeen: Set<string>,
  note: (key: string, info: Meta, excerpt: string) => void,
): Promise<void> {
  const state = await readState(docker, container.Id);
  if (!state) return;

  if (state.OOMKilled) {
    note(
      `${container.service}:oom`,
      meta(container, ["oom"], "container was OOMKilled", "sha256:oomkilled", "error-spike"),
      "OOMKilled",
    );
  }

  const previous = restartCounts.get(container.Id);
  const current = state.RestartCount ?? 0;
  if (previous !== undefined && current > previous) {
    note(
      `${container.service}:restart`,
      meta(container, ["restart"], "container restart count increased", "sha256:restart", "error-spike"),
      `RestartCount ${previous} -> ${current}`,
    );
  }
  restartCounts.set(container.Id, current);

  if (!container.service.endsWith("-migrate") || state.Status !== "exited" || !state.ExitCode) return;
  const finished = state.FinishedAt ?? "";
  const seenKey = `${container.Id}:${finished}`;
  if (migrateSeen.has(seenKey)) return;
  migrateSeen.add(seenKey);
  const logs = await readLogs(docker, container.Id);
  note(
    `${container.service}:migrate:${finished}`,
    meta(container, ["migration"], `migrate exited ${state.ExitCode}`, "sha256:migrate-exit", "migration-failed"),
    redact(logs || `exit ${state.ExitCode}`),
  );
}

function meta(
  container: ListedContainer,
  kinds: Kind[],
  signature: string,
  signatureHash: string,
  alert: Meta["alert"],
): Meta {
  return {
    service: container.service,
    container: container.name,
    kinds,
    signature,
    signatureHash,
    alert,
  };
}

async function readState(
  docker: ReturnType<typeof createDocker>,
  id: string,
): Promise<{
  OOMKilled?: boolean;
  RestartCount?: number;
  ExitCode?: number;
  Status?: string;
  FinishedAt?: string;
} | null> {
  try {
    const info = await docker.getContainer(id).inspect();
    return info.State;
  } catch {
    return null;
  }
}

async function readLogs(docker: ReturnType<typeof createDocker>, id: string): Promise<string> {
  try {
    const data = await docker.getContainer(id).logs({
      follow: false,
      stdout: true,
      stderr: true,
      tail: 80,
    });
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
    return demuxDockerFrames(buffer).frames.map((frame) => frame.text).join("");
  } catch {
    return "";
  }
}

function isReadable(value: unknown): value is Readable {
  return !!value && typeof value === "object" && "on" in value && "destroy" in value;
}

main().catch((error: unknown) => {
  console.error("[log-watcher]", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
