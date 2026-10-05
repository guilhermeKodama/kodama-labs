import { PassThrough, type Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { detectKinds } from "../detect.js";
import { demuxDockerFrames, encodeDockerFrame, MAX_DOCKER_FRAME_BYTES } from "../docker-frames.js";
import type { ListedContainer } from "../docker.js";
import { compileIgnore, isIgnored } from "../ignore.js";
import {
  attachLogFollow,
  boundLogBuffer,
  containersToFollow,
  forgetMeta,
  MAX_LOG_BUFFER_BYTES,
  PENDING_CAP,
  pruneContainerMaps,
} from "../log-follow.js";
import { RateLimiter } from "../rate-limit.js";
import { redact } from "../redact.js";
import { signatureOf } from "../signature.js";

const container: ListedContainer = {
  Id: "abc",
  State: "running",
  service: "capital-web",
  name: "capital-web",
};

const REMINDER = `prisma:error
Invalid \`prisma.reminderDispatch.create()\` invocation in
/repo/apps/capital/src/server/modules/recurring/services/send-due-reminders.ts:143:48

Unique constraint failed on the fields: (\`recurringTransactionId\`,\`occurrenceDate\`,\`daysBefore\`)`;

describe("detectKinds", () => {
  it("matches request lines with a 5xx status and ignores a bare 500", () => {
    expect(detectKinds("--> GET /api/cron/send-reminders 500 12ms")).toContain("http-5xx");
    expect(detectKinds("statusCode=502 gateway")).toContain("http-5xx");
    expect(detectKinds("budget line 500 for the year")).toEqual([]);
  });

  it("classifies prisma errors, stacks, migrations and oom", () => {
    expect(detectKinds("prisma:error\nUnique constraint failed")).toContain("prisma-error");
    expect(detectKinds("Error: boom\n    at handler (route.ts:10:4)")).toContain("exception");
    expect(detectKinds("Migration `20261005` failed to apply")).toContain("migration");
    expect(detectKinds("P3009 migrate found failed migrations")).toContain("migration");
    expect(detectKinds("JavaScript heap out of memory")).toEqual(["oom"]);
  });
});

describe("ignore", () => {
  const patterns = compileIgnore();

  it("drops the reminderDispatch unique-constraint noise", () => {
    expect(isIgnored(REMINDER, patterns)).toBe(true);
  });

  it("keeps a unique constraint on a different model", () => {
    const text = "prisma:error\nInvalid `prisma.category.create()` invocation:\n\nUnique constraint failed on the fields: (`name`)";
    expect(isIgnored(text, patterns)).toBe(false);
    expect(detectKinds(text)).toContain("prisma-error");
  });

  it("drops the cron runner's per-job failure line", () => {
    expect(isIgnored("[Cron] [2026-10-05T00:00:00.000Z] capital/api/cron/x failed with status 500", patterns)).toBe(true);
  });
});

describe("signature", () => {
  it("groups the same error with different ids and timestamps", () => {
    const a = signatureOf("Error: failed for 11111111-1111-1111-1111-111111111111 at 2026-10-05T00:00:00.000Z\n    at run (job.ts:4:2)");
    const b = signatureOf("Error: failed for 22222222-2222-2222-2222-222222222222 at 2026-10-05T01:02:03.000Z\n    at run (job.ts:9:8)");
    expect(a.hash).toBe(b.hash);
  });

  it("separates different errors", () => {
    const a = signatureOf("Error: unique constraint\n    at create (a.ts:1:1)");
    const b = signatureOf("Error: record not found\n    at create (a.ts:1:1)");
    expect(a.hash).not.toBe(b.hash);
  });
});

describe("rate limit", () => {
  it("emits one alert for a burst, then one more after the suppress window", () => {
    const limiter = new RateLimiter(15_000, 30 * 60_000);
    const start = Date.parse("2026-10-05T00:00:00.000Z");
    for (let i = 0; i < 20; i++) limiter.observe("capital:sig", start, "first");
    expect(limiter.collect(start + 10_000)).toEqual([]);
    const first = limiter.collect(start + 15_000);
    expect(first).toHaveLength(1);
    expect(first[0]?.count).toBe(20);
    expect(first[0]?.excerpt).toBe("first");

    limiter.observe("capital:sig", start + 16_000, "later");
    expect(limiter.collect(start + 20_000)).toEqual([]);
    const second = limiter.collect(start + 15_000 + 30 * 60_000);
    expect(second).toHaveLength(1);
    expect(second[0]?.count).toBe(1);
    expect(second[0]?.excerpt).toBe("later");
  });

  it("expires the bucket so the watcher can drop its meta", () => {
    const limiter = new RateLimiter(15_000, 30 * 60_000);
    const meta = new Map<string, string>([["capital:sig", "info"]]);
    const start = Date.parse("2026-10-05T00:00:00.000Z");
    limiter.observe("capital:sig", start, "first");
    expect(limiter.collect(start + 15_000)).toHaveLength(1);
    forgetMeta(meta, limiter.drainExpired());
    expect(meta.has("capital:sig")).toBe(true);
    expect(limiter.collect(start + 15_000 + 30 * 60_000)).toEqual([]);
    forgetMeta(meta, limiter.drainExpired());
    expect(meta.has("capital:sig")).toBe(false);
  });
});

describe("redact", () => {
  it("scrubs urls, bearer tokens, jwts and emails", () => {
    const raw = [
      "postgresql://root:root@postgres:5432/capital",
      "Authorization: Bearer super-secret",
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.abc",
      "user@example.com",
      "DATABASE_URL=postgresql://a:b@h/db",
    ].join(" ");
    const out = redact(raw, 2000);
    expect(out).not.toContain("root:root");
    expect(out).not.toContain("super-secret");
    expect(out).not.toContain("eyJhbGci");
    expect(out).not.toContain("user@example.com");
    expect(out).toContain("postgresql://***");
    expect(out).toContain("Bearer ***");
    expect(out).toContain("[jwt]");
    expect(out).toContain("[email]");
  });

  it("keeps the unique-constraint phrase so ignore matching stays independent", () => {
    expect(redact(REMINDER)).toContain("Unique constraint failed");
  });
});

describe("docker frames", () => {
  it("splits multiplexed frames and keeps a partial header", () => {
    const raw = Buffer.concat([
      encodeDockerFrame(1, "stdout-line\n"),
      encodeDockerFrame(2, "stderr-line\n"),
    ]);
    const split = demuxDockerFrames(Buffer.concat([raw.subarray(0, 10), raw.subarray(10)]));
    expect(split.frames.map((frame) => frame.text)).toEqual(["stdout-line\n", "stderr-line\n"]);
    expect(split.frames.map((frame) => frame.stream)).toEqual([1, 2]);

    const partial = demuxDockerFrames(raw.subarray(0, 4));
    expect(partial.frames).toEqual([]);
    expect(partial.rest.length).toBe(4);
    expect(partial.corrupted).toBe(false);
  });

  it("drops the buffer when a header claims more than 1 MiB", () => {
    const header = Buffer.alloc(8);
    header[0] = 1;
    header.writeUInt32BE(MAX_DOCKER_FRAME_BYTES + 1, 4);
    const raw = Buffer.concat([encodeDockerFrame(1, "kept\n"), header, Buffer.from("tail")]);
    const demuxed = demuxDockerFrames(raw);
    expect(demuxed.corrupted).toBe(true);
    expect(demuxed.rest.length).toBe(0);
    expect(demuxed.frames.map((frame) => frame.text)).toEqual(["kept\n"]);
  });
});

describe("log follow", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("re-follows after the stream ends while the container is still listed", async () => {
    const following = new Map<string, Readable>();
    const stream = new PassThrough();
    let flushes = 0;
    attachLogFollow({
      stream,
      container,
      following,
      onChunk: () => {
        flushes += 1;
      },
    });
    stream.write(encodeDockerFrame(1, "Error: boom\n    at run (a.ts:1:1)\n"));
    expect(following.has(container.Id)).toBe(true);
    const closed = new Promise((resolve) => stream.once("close", resolve));
    stream.end();
    await closed;
    expect(flushes).toBe(1);
    expect(following.has(container.Id)).toBe(false);
    expect(containersToFollow([container], following, new Set()).map((item) => item.Id)).toEqual([
      container.Id,
    ]);
  });

  it("finishes once when error and close both fire", () => {
    const following = new Map<string, Readable>();
    const stream = new PassThrough();
    let flushes = 0;
    attachLogFollow({
      stream,
      container,
      following,
      onChunk: () => {
        flushes += 1;
      },
    });
    stream.write(encodeDockerFrame(1, "Error: boom\n    at run (a.ts:1:1)\n"));
    stream.emit("error", new Error("dropped"));
    stream.emit("close");
    expect(flushes).toBe(1);
    expect(following.has(container.Id)).toBe(false);
  });

  it("flushes a continuous flood on the max wait", async () => {
    vi.useFakeTimers();
    const following = new Map<string, Readable>();
    const stream = new PassThrough();
    const flushes: string[] = [];
    attachLogFollow({
      stream,
      container,
      following,
      onChunk: (_item, text) => {
        flushes.push(text);
      },
    });
    const frame = encodeDockerFrame(1, "line\n");
    for (let elapsed = 0; elapsed < 5000; elapsed += 100) {
      stream.write(frame);
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(flushes.length).toBeGreaterThanOrEqual(2);
    expect(flushes.join("")).toContain("line");
  });

  it("flushes once pending text exceeds 64 KiB", () => {
    const following = new Map<string, Readable>();
    const stream = new PassThrough();
    const flushes: string[] = [];
    attachLogFollow({
      stream,
      container,
      following,
      onChunk: (_item, text) => {
        flushes.push(text);
      },
    });
    const frame = encodeDockerFrame(1, "y".repeat(20_000));
    stream.write(frame);
    stream.write(frame);
    stream.write(frame);
    stream.write(frame);
    expect(flushes.join("").length).toBeGreaterThanOrEqual(PENDING_CAP);
  });

  it("drops a corrupt frame and still reads the next one", async () => {
    vi.useFakeTimers();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const following = new Map<string, Readable>();
    const stream = new PassThrough();
    const flushes: string[] = [];
    attachLogFollow({
      stream,
      container,
      following,
      onChunk: (_item, text) => {
        flushes.push(text);
      },
    });
    const header = Buffer.alloc(8);
    header.writeUInt32BE(MAX_DOCKER_FRAME_BYTES + 1, 4);
    stream.write(header);
    stream.write(encodeDockerFrame(1, "after\n"));
    await vi.advanceTimersByTimeAsync(500);
    expect(error).toHaveBeenCalled();
    expect(flushes).toEqual(["after\n"]);
  });

  it("drops an oversized demux tail", () => {
    const oversized = boundLogBuffer(Buffer.alloc(MAX_LOG_BUFFER_BYTES + 1));
    expect(oversized.dropped).toBe(true);
    expect(oversized.buf.length).toBe(0);
    expect(boundLogBuffer(Buffer.alloc(8)).dropped).toBe(false);
  });

  it("prunes restart and migrate state for containers that are gone", () => {
    const restartCounts = new Map<string, number>([
      ["alive", 1],
      ["gone", 3],
    ]);
    const migrateSeen = new Set([
      "alive:2026-10-05T00:00:00.000Z",
      "gone:2026-10-05T00:00:00.000Z",
    ]);
    pruneContainerMaps(new Set(["alive"]), restartCounts, migrateSeen);
    expect([...restartCounts.keys()]).toEqual(["alive"]);
    expect([...migrateSeen]).toEqual(["alive:2026-10-05T00:00:00.000Z"]);
  });
});
