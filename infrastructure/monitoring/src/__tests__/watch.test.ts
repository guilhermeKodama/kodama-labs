import { describe, expect, it } from "vitest";
import { detectKinds } from "../detect.js";
import { demuxDockerFrames, encodeDockerFrame } from "../docker-frames.js";
import { compileIgnore, isIgnored } from "../ignore.js";
import { RateLimiter } from "../rate-limit.js";
import { redact } from "../redact.js";
import { signatureOf } from "../signature.js";

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
  });
});
