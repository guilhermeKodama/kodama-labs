import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@capital/server/lib/prisma";

const services = vi.hoisted(() => ({
  processDueRules: vi.fn(),
  purgeTrash: vi.fn(),
  sendDueReminders: vi.fn(),
  categorizePendingEntries: vi.fn(),
}));
vi.mock("@capital/server/modules/recurring/services/recurring-rules", () => ({ processDueRules: services.processDueRules }));
vi.mock("@capital/server/modules/ledger/services/entries", () => ({ purgeTrash: services.purgeTrash }));
vi.mock("@capital/server/modules/recurring/services/send-due-reminders", () => ({ sendDueReminders: services.sendDueReminders }));
vi.mock("@capital/server/modules/categories/services/ai-categorize", () => ({ categorizePendingEntries: services.categorizePendingEntries }));

import { env } from "@/env";
import { GET as processRecurring } from "../process-recurring/route";
import { GET as sendReminders } from "../send-reminders/route";
import { GET as categorize } from "../categorize/route";

const request = (path: string, authorization?: string) =>
  new NextRequest(`http://localhost/api/cron/${path}`, { headers: authorization ? { authorization } : {} });
const authed = (path: string) => request(path, `Bearer ${env.CRON_SECRET}`);

beforeEach(() => {
  for (const fn of Object.values(services)) fn.mockReset();
  // The routes log the error they turn into a 500; keep the test output clean.
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("process-recurring cron", () => {
  it("refuses a missing or wrong secret before touching any service", async () => {
    expect((await processRecurring(request("process-recurring"))).status).toBe(401);
    expect((await processRecurring(request("process-recurring", "Bearer wrong"))).status).toBe(401);
    expect((await processRecurring(request("process-recurring", env.CRON_SECRET))).status).toBe(401);
    expect(services.processDueRules).not.toHaveBeenCalled();
    expect(services.purgeTrash).not.toHaveBeenCalled();
  });

  it("books the due rules, purges trash older than 30 days and reports both", async () => {
    services.processDueRules.mockResolvedValue({ rulesProcessed: 3, entriesCreated: 5 });
    services.purgeTrash.mockResolvedValue({ entries: 2, groups: 1 });

    const res = await processRecurring(authed("process-recurring"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, recurring: { rulesProcessed: 3, entriesCreated: 5 }, trash: { entries: 2, groups: 1 } });
    expect(new Date(body.processedAt).getTime()).toBeGreaterThan(Date.now() - 60_000);
    // Compared by identity: a deep equality walk over the Prisma client overflows the stack.
    expect(services.processDueRules.mock.calls[0][0]).toBe(prisma);
    expect(services.purgeTrash.mock.calls[0][0]).toBe(prisma);
    expect(services.purgeTrash.mock.calls[0][1]).toBe(30);
  });

  it("answers 500 with the error message when booking fails, and does not purge", async () => {
    services.processDueRules.mockRejectedValue(new Error("db down"));

    const res = await processRecurring(authed("process-recurring"));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: "db down" });
    expect(services.purgeTrash).not.toHaveBeenCalled();
  });

  it("answers 500 'Unknown error' when something that is not an Error is thrown", async () => {
    services.processDueRules.mockResolvedValue({});
    services.purgeTrash.mockRejectedValue("string failure");

    const res = await processRecurring(authed("process-recurring"));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: "Unknown error" });
  });
});

describe("send-reminders cron", () => {
  it("refuses a missing or wrong secret", async () => {
    expect((await sendReminders(request("send-reminders"))).status).toBe(401);
    expect((await sendReminders(request("send-reminders", "Bearer nope"))).status).toBe(401);
    expect(services.sendDueReminders).not.toHaveBeenCalled();
  });

  it("sends the due reminders and spreads the counters into the body", async () => {
    services.sendDueReminders.mockResolvedValue({ rowsScanned: 4, notificationsSent: 2, notificationsFailed: 0 });

    const res = await sendReminders(authed("send-reminders"));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, rowsScanned: 4, notificationsSent: 2, notificationsFailed: 0 });
    expect(services.sendDueReminders).toHaveBeenCalledTimes(1);
    expect(services.sendDueReminders.mock.calls[0][0]).toBe(prisma);
  });

  it("answers 500 with the message of the failure", async () => {
    services.sendDueReminders.mockRejectedValue(new Error("push gateway timeout"));

    const res = await sendReminders(authed("send-reminders"));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: "push gateway timeout" });
  });

  it("answers 500 'Unknown error' for a thrown non-Error", async () => {
    services.sendDueReminders.mockRejectedValue(42);

    const res = await sendReminders(authed("send-reminders"));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: "Unknown error" });
  });
});

describe("categorize cron", () => {
  it("refuses a missing or wrong secret", async () => {
    expect((await categorize(request("categorize"))).status).toBe(401);
    expect((await categorize(request("categorize", "Bearer nope"))).status).toBe(401);
    expect(services.categorizePendingEntries).not.toHaveBeenCalled();
  });

  it("categorizes one chunk and returns the chunk's counters", async () => {
    services.categorizePendingEntries.mockResolvedValue({ userId: "u1", processed: 20, remaining: 7 });

    const res = await categorize(authed("categorize"));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, userId: "u1", processed: 20, remaining: 7 });
    expect(services.categorizePendingEntries).toHaveBeenCalledTimes(1);
    expect(services.categorizePendingEntries.mock.calls[0][0]).toBe(prisma);
  });

  it("answers 500 with the message when the categorizer fails", async () => {
    services.categorizePendingEntries.mockRejectedValue(new Error("anthropic 529"));

    const res = await categorize(authed("categorize"));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: "anthropic 529" });
  });

  it("answers 500 'Unknown error' for a thrown non-Error", async () => {
    services.categorizePendingEntries.mockRejectedValue(null);

    const res = await categorize(authed("categorize"));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: "Unknown error" });
  });
});
