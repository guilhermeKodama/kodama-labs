import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createApp } from "@capital/server/lib/create-app";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";

const USER = "test-user-recurring-routes-001";
const OTHER = "test-user-recurring-routes-002";
const app = createApp();
let f: LedgerFixture;
let o: LedgerFixture;
let cookie: string;

beforeAll(async () => {
  f = await createLedgerFixture(prisma, USER, { categories: [{ name: "Lazer", type: "expense" }] });
  o = await createLedgerFixture(prisma, OTHER);
  const session = await prisma.session.create({ data: { userId: USER, expiresAt: new Date(Date.now() + 3600_000) } });
  cookie = `capital_session=${session.id}`;
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-22T15:00:00Z"));
});

afterEach(async () => {
  vi.useRealTimers();
  await prisma.ledgerEntry.deleteMany({ where: { userId: USER } });
  await prisma.transferGroup.deleteMany({ where: { userId: USER } });
  await prisma.recurringRule.deleteMany({ where: { userId: USER } });
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
  await deleteLedgerFixture(prisma, OTHER);
});

const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(`/api${path}`, {
    method,
    headers: { cookie, ...(body !== undefined && { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};
const create = (extra: Record<string, unknown> = {}) =>
  call("POST", "/v2/recurring", { kind: "expense", accountId: f.pfChecking, amount: 40, description: "Streaming", frequency: "monthly", startDate: "2026-08-22", ...extra });

describe("DELETE /v2/recurring/{id}", () => {
  it("deletes the rule, leaves the booked entries unlinked, and undo brings the rule back", async () => {
    const created = await create();
    expect(created.body.booked.count).toBe(2);
    const removed = await call("DELETE", `/v2/recurring/${created.body.id}`);
    expect(removed.body).toMatchObject({ success: true, batchId: expect.any(String) });
    expect(await prisma.recurringRule.count({ where: { id: created.body.id } })).toBe(0);
    expect(await prisma.ledgerEntry.count({ where: { userId: USER, recurringRuleId: null, deletedAt: null } })).toBe(2);
    expect((await call("POST", `/v2/mutations/${removed.body.batchId}/undo`)).status).toBe(200);
    expect(await prisma.ledgerEntry.count({ where: { recurringRuleId: created.body.id } })).toBe(2);
  });

  it("404s for a rule that is gone or someone else's", async () => {
    const theirs = await prisma.recurringRule.create({
      data: { userId: OTHER, entityId: o.pfId, accountId: o.pfChecking, kind: "expense", amount: 5, currency: "BRL", description: "Dela", frequency: "monthly", startDate: new Date("2026-09-01T12:00:00Z"), nextDueDate: new Date("2026-10-01T12:00:00Z") },
    });
    expect((await call("DELETE", `/v2/recurring/${theirs.id}`)).body).toMatchObject({ code: "recurring.not_found" });
    expect((await call("DELETE", "/v2/recurring/nope")).status).toBe(404);
    expect((await call("POST", "/v2/recurring/nope/pay", {})).status).toBe(404);
    expect((await call("POST", "/v2/recurring/nope/skip")).status).toBe(404);
    expect((await call("PATCH", "/v2/recurring/nope", { amount: 5 })).status).toBe(404);
    expect(await prisma.recurringRule.count({ where: { id: theirs.id } })).toBe(1);
  });
});

describe("GET /v2/recurring", () => {
  it("lists paused rules only when asked, and scopes to an entity id", async () => {
    await create({ description: "Ativa", startDate: "2026-10-05" });
    const paused = await create({ description: "Pausada", startDate: "2026-10-06" });
    await call("PATCH", `/v2/recurring/${paused.body.id}`, { isActive: false });
    const names = async (query: string) => (await call("GET", `/v2/recurring${query}`)).body.rules.map((r: { description: string }) => r.description);
    expect(await names("")).toEqual(["Ativa"]);
    expect(await names("?includeInactive=true")).toEqual(["Ativa", "Pausada"]);
    expect(await names("?includeInactive=false")).toEqual(["Ativa"]);
    expect(await names(`?scope=${f.pfId}`)).toEqual(["Ativa"]);
    expect(await names(`?scope=${f.pjId}`)).toEqual([]);
    expect((await call("GET", `/v2/recurring?scope=${o.pfId}`)).body).toMatchObject({ code: "entity.not_found" });
    expect((await call("GET", "/v2/recurring?includeInactive=maybe")).status).toBe(422);
  });
});

describe("validation", () => {
  it("rejects a bad body: no amount, a zero amount, a transfer with no destination, a bad date", async () => {
    expect((await create({ amount: 0 })).status).toBe(422);
    expect((await create({ amount: undefined })).status).toBe(422);
    expect((await create({ startDate: "22/09/2026" })).status).toBe(422);
    expect((await create({ frequency: "hourly" })).status).toBe(422);
    const transfer = await create({ kind: "transfer" });
    expect(transfer.status).toBe(422);
    expect(transfer.body).toMatchObject({ code: "recurring.transfer_needs_destination" });
    expect(await prisma.recurringRule.count({ where: { userId: USER } })).toBe(0);
  });

  it("pays a rule on another date and amount, and the entry carries them", async () => {
    const rule = await create({ startDate: "2026-09-30", autoGenerate: false });
    const paid = await call("POST", `/v2/recurring/${rule.body.id}/pay`, { date: "2026-09-21", amount: 41.5 });
    expect(paid.status).toBe(200);
    expect(paid.body.rule.nextDueDate).toBe("2026-10-30");
    const entry = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: paid.body.entryIds[0] } });
    expect(entry.date.toISOString().slice(0, 10)).toBe("2026-09-21");
    expect(Number(entry.amount)).toBe(-41.5);
    expect((await call("POST", `/v2/recurring/${rule.body.id}/pay`, { amount: -1 })).status).toBe(422);
  });
});
