import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@capital/server/lib/prisma";
import { withCron } from "../cron";

const JOB = "test-cron-job";
const request = (secret?: string) => new NextRequest("http://localhost/api/cron/test", { headers: secret ? { authorization: `Bearer ${secret}` } : {} });

afterEach(async () => {
  await prisma.integrationRun.deleteMany({ where: { job: JOB } });
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
