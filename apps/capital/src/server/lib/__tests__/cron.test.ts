import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@capital/server/lib/prisma";
import { cronAuthorized, runStage, withCron, withCronPipeline } from "../cron";

const JOB = "test-cron-job";
const request = (secret?: string) => new NextRequest("http://localhost/api/cron/test", { headers: secret ? { authorization: `Bearer ${secret}` } : {} });

// Every job name this file writes starts with this prefix, so cleanup never touches other files' runs.
const JOB_PREFIX = "test-cron-";

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await prisma.integrationRun.deleteMany({ where: { job: { startsWith: JOB_PREFIX } } });
});

describe("withCron", () => {
  it("refuses a request with no secret configured match, without running the job", async () => {
    let ran = false;
    const res = await withCron(request("wrong-secret"), { job: JOB }, async () => {
      ran = true;
      return { status: "ok" };
    });
    expect(res.status).toBe(401);
    expect(ran).toBe(false);
    expect(await prisma.integrationRun.count({ where: { job: JOB } })).toBe(0);
  });

  it("refuses a request with no authorization header at all", async () => {
    const res = await withCron(request(), { job: JOB }, async () => ({ status: "ok" }));
    expect(res.status).toBe(401);
  });

  it("maps ok to 200, success:true and records the run", async () => {
    const res = await withCron(request(process.env.CRON_SECRET), { job: JOB }, async () => ({
      status: "ok",
      requested: 3,
      succeeded: 3,
      body: { message: "all good" },
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, status: "ok", message: "all good" });
    const run = await prisma.integrationRun.findFirst({ where: { job: JOB } });
    expect(run).toMatchObject({ status: "ok", trigger: "cron", requested: 3, succeeded: 3 });
  });

  it("maps partial to 200 with degraded:true", async () => {
    const res = await withCron(request(process.env.CRON_SECRET), { job: JOB }, async () => ({ status: "partial", missing: 2 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ success: false, status: "partial", degraded: true });
  });

  it("maps failed to 503 and records the error", async () => {
    const res = await withCron(request(process.env.CRON_SECRET), { job: JOB }, async () => ({ status: "failed", error: "provider down" }));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toMatchObject({ success: false, status: "failed", error: "provider down" });
    const run = await prisma.integrationRun.findFirst({ where: { job: JOB } });
    expect(run?.error).toBe("provider down");
  });

  it("catches a thrown error, still records it as failed and returns 503", async () => {
    const res = await withCron(request(process.env.CRON_SECRET), { job: JOB }, async () => {
      throw new Error("boom");
    });
    expect(res.status).toBe(503);
    const run = await prisma.integrationRun.findFirst({ where: { job: JOB } });
    expect(run).toMatchObject({ status: "failed", error: "boom" });
  });

  it("maps skipped to 200 and success:true", async () => {
    const res = await withCron(request(process.env.CRON_SECRET), { job: JOB }, async () => ({ status: "skipped", body: { message: "not configured" } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, status: "skipped", message: "not configured" });
  });
});

describe("cronAuthorized", () => {
  it("accepts exactly the configured secret as a Bearer token", () => {
    expect(cronAuthorized(request(process.env.CRON_SECRET))).toBe(true);
    expect(cronAuthorized(request("nope"))).toBe(false);
    expect(cronAuthorized(request())).toBe(false);
  });

  it("rejects the secret without the Bearer prefix", () => {
    const raw = new NextRequest("http://localhost/api/cron/test", { headers: { authorization: process.env.CRON_SECRET! } });
    expect(cronAuthorized(raw)).toBe(false);
  });
});

describe("runStage", () => {
  it("records every field of the result on the IntegrationRun, as a manual trigger", async () => {
    const providerLatestDate = new Date("2026-11-10T00:00:00.000Z");
    const { job, result, startedAt, finishedAt } = await runStage(
      `${JOB_PREFIX}full`,
      async () => ({
        status: "partial",
        provider: "yahoo",
        requested: 10,
        succeeded: 7,
        missing: 2,
        rejected: 1,
        providerLatestDate,
        error: "3 tickers failed",
        stats: { bySource: { yahoo: 7 } },
      }),
      { trigger: "manual" },
    );

    expect(job).toBe(`${JOB_PREFIX}full`);
    expect(result.status).toBe("partial");
    expect(finishedAt.getTime()).toBeGreaterThanOrEqual(startedAt.getTime());
    const run = await prisma.integrationRun.findFirstOrThrow({ where: { job: `${JOB_PREFIX}full` } });
    expect(run).toMatchObject({
      provider: "yahoo",
      trigger: "manual",
      status: "partial",
      requested: 10,
      succeeded: 7,
      missing: 2,
      rejected: 1,
      error: "3 tickers failed",
      providerLatestDate,
      stats: { bySource: { yahoo: 7 } },
    });
    expect(run.startedAt).toEqual(startedAt);
    expect(run.finishedAt).toEqual(finishedAt);
    expect(run.durationMs).toBe(finishedAt.getTime() - startedAt.getTime());
  });

  it("stores nulls for what the job did not report, and defaults the trigger to cron", async () => {
    await runStage(`${JOB_PREFIX}bare`, async () => ({ status: "ok" }));
    const run = await prisma.integrationRun.findFirstOrThrow({ where: { job: `${JOB_PREFIX}bare` } });
    expect(run).toMatchObject({ trigger: "cron", status: "ok", provider: null, requested: null, succeeded: null, missing: null, rejected: null, providerLatestDate: null, error: null });
  });

  it("turns a thrown non-Error into a failed result carrying its text", async () => {
    const { result } = await runStage(`${JOB_PREFIX}throws-string`, async () => {
      throw "plain string";
    });
    expect(result).toEqual({ status: "failed", error: "plain string" });
    expect((await prisma.integrationRun.findFirstOrThrow({ where: { job: `${JOB_PREFIX}throws-string` } })).error).toBe("plain string");
  });

  it("still returns the result when the run cannot be recorded", async () => {
    // Postgres refuses a NUL byte in text, so the insert is rejected.
    const provider = "bad\u0000provider";

    const { result } = await runStage(`${JOB_PREFIX}unrecorded`, async () => ({ status: "ok", requested: 1, provider }));

    expect(result).toEqual({ status: "ok", requested: 1, provider });
    expect(await prisma.integrationRun.count({ where: { job: `${JOB_PREFIX}unrecorded` } })).toBe(0);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("failed to record IntegrationRun"), expect.any(Error));
  });
});

describe("withCronPipeline", () => {
  const stage = (suffix: string, result: Awaited<ReturnType<Parameters<typeof runStage>[1]>>) => ({ job: `${JOB_PREFIX}pipe-${suffix}`, run: async () => result });

  it("refuses an unauthorized request before running any stage", async () => {
    const run = vi.fn(async () => ({ status: "ok" as const }));
    const res = await withCronPipeline(request("wrong"), [{ job: `${JOB_PREFIX}pipe-never`, run }]);
    expect(res.status).toBe(401);
    expect(run).not.toHaveBeenCalled();
    expect(await prisma.integrationRun.count({ where: { job: `${JOB_PREFIX}pipe-never` } })).toBe(0);
  });

  it("runs the stages in order, records one run each and answers ok", async () => {
    const order: string[] = [];
    const res = await withCronPipeline(request(process.env.CRON_SECRET), [
      { job: `${JOB_PREFIX}pipe-a`, run: async () => (order.push("a"), { status: "ok" as const }) },
      { job: `${JOB_PREFIX}pipe-b`, run: async () => (order.push("b"), { status: "skipped" as const }) },
    ]);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, status: "ok" });
    expect(body.stages.map((s: { job: string; status: string }) => [s.job, s.status])).toEqual([
      [`${JOB_PREFIX}pipe-a`, "ok"],
      [`${JOB_PREFIX}pipe-b`, "skipped"],
    ]);
    expect(order).toEqual(["a", "b"]);
    expect(await prisma.integrationRun.count({ where: { job: { startsWith: `${JOB_PREFIX}pipe-` } } })).toBe(2);
  });

  it("answers skipped when every stage was skipped", async () => {
    const res = await withCronPipeline(request(process.env.CRON_SECRET), [stage("s1", { status: "skipped" }), stage("s2", { status: "skipped" })]);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, status: "skipped" });
  });

  it("is partial (200, degraded) when the worst stage is partial", async () => {
    const res = await withCronPipeline(request(process.env.CRON_SECRET), [stage("p1", { status: "ok" }), stage("p2", { status: "partial", error: "2 missing" })]);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ success: false, status: "partial", degraded: true });
    expect(body.stages[1]).toMatchObject({ status: "partial", error: "2 missing" });
    expect(body.stages[0]).not.toHaveProperty("error");
  });

  it("keeps running after a failed stage and answers 503 naming the failed jobs", async () => {
    const after = vi.fn(async () => ({ status: "ok" as const }));
    const res = await withCronPipeline(request(process.env.CRON_SECRET), [
      stage("f1", { status: "failed", error: "provider down" }),
      { job: `${JOB_PREFIX}pipe-f2`, run: after },
      stage("f3", { status: "failed", error: "also down" }),
    ]);

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ success: false, status: "failed", error: `failed: ${JOB_PREFIX}pipe-f1, ${JOB_PREFIX}pipe-f3` });
    expect(after).toHaveBeenCalledTimes(1);
  });

  it("answers skipped (200) for a pipeline with no stages", async () => {
    const res = await withCronPipeline(request(process.env.CRON_SECRET), []);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, status: "skipped", stages: [] });
    expect(new Date(body.processedAt).getTime()).toBeGreaterThan(Date.now() - 60_000);
  });
});
