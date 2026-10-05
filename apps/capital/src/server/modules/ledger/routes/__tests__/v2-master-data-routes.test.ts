import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createApp } from "@capital/server/lib/create-app";
import { parseLocalDate } from "@capital/server/lib/date-utils";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { openStatements, userCalendarDay } from "../../services/statements";

/** Ajustes master data: entities' account counts, the card's open statement, set-balance and the account currency/entity guards. */
const USER = "test-user-s6-master-data-001";
const OTHER = "test-user-s6-master-data-002";
const app = createApp();
let f: LedgerFixture;
let cookie: string;

const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(`/api${path}`, {
    method,
    headers: { cookie, ...(body !== undefined && { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

const purchase = (amount: number, date: string, description = "Compra") =>
  call("POST", "/v2/ledger/entries", { kind: "expense", accountId: f.card, amount, date, description });

beforeEach(async () => {
  f = await createLedgerFixture(prisma, USER);
  const session = await prisma.session.create({ data: { userId: USER, expiresAt: new Date(Date.now() + 3600_000) } });
  cookie = `capital_session=${session.id}`;
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
  await deleteLedgerFixture(prisma, OTHER);
});

describe("GET /v2/entities", () => {
  it("carries how many unarchived accounts and cards each entity has", async () => {
    const counts = async () => Object.fromEntries(((await call("GET", "/v2/entities")).body as { id: string; accountsCount: number }[]).map((e) => [e.id, e.accountsCount]));
    expect(await counts()).toEqual({ [f.pfId]: 3, [f.pjId]: 1 }); // PF: checking, card, broker
    expect((await call("PATCH", `/v2/accounts/${f.broker}`, { archived: true })).status).toBe(200);
    expect((await counts())[f.pfId]).toBe(2);
  });
});

describe("open card statement", () => {
  it("is the statement whose closing date has not passed, with its purchases net of refunds", async () => {
    // Closes on the 5th, due on the 12th: purchases from 6 Sep to 5 Oct are on October's statement.
    await purchase(120, "2026-09-20");
    await purchase(80.5, "2026-10-03");
    await call("POST", "/v2/ledger/entries", { kind: "income", accountId: f.card, amount: 20, date: "2026-10-04", description: "Estorno" });
    await purchase(999, "2026-09-02"); // September's statement
    const card = await prisma.account.findUniqueOrThrow({ where: { id: f.card } });

    const open = (await openStatements([card], prisma, parseLocalDate("2026-10-04"))).get(f.card)!;
    expect(open).toMatchObject({ month: "2026-10", total: 180.5, count: 3, closingDate: "2026-10-05", dueDate: "2026-10-12", statementId: expect.any(String) });

    // On the 5th it is still open; from the 6th November's is, with nothing on it yet.
    expect((await openStatements([card], prisma, parseLocalDate("2026-10-05"))).get(f.card)).toMatchObject({ month: "2026-10", total: 180.5 });
    expect((await openStatements([card], prisma, parseLocalDate("2026-10-06"))).get(f.card)).toEqual({
      statementId: null,
      month: "2026-11",
      total: 0,
      count: 0,
      closingDate: "2026-11-05",
      dueDate: "2026-11-12",
    });
  });

  it("follows a statement's own closing date, and a due day before the closing day falls in the next month", async () => {
    await purchase(50, "2026-10-01");
    // The bill (imported) closed on the 3rd: on the 4th October's statement is closed already.
    const october = await prisma.cardStatement.findFirstOrThrow({ where: { accountId: f.card, month: "2026-10" } });
    await prisma.cardStatement.update({ where: { id: october.id }, data: { closingDate: parseLocalDate("2026-10-03") } });
    const card = await prisma.account.findUniqueOrThrow({ where: { id: f.card } });
    expect((await openStatements([card], prisma, parseLocalDate("2026-10-04"))).get(f.card)).toMatchObject({ month: "2026-11", total: 0 });

    // Closing on the 25th and due on the 5th: October's bill is due in November.
    const lateClose = { id: "card-without-statements", closingDay: 25, dueDay: 5 };
    expect((await openStatements([lateClose], prisma, parseLocalDate("2026-10-10"))).get(lateClose.id)).toMatchObject({
      month: "2026-10",
      closingDate: "2026-10-25",
      dueDate: "2026-11-05",
    });
  });

  it("is on card rows of GET /v2/accounts only", async () => {
    const today = userCalendarDay("America/Sao_Paulo");
    const ymd = today.toISOString().slice(0, 10);
    await purchase(42, ymd);
    const rows = (await call("GET", "/v2/accounts")).body as { id: string; openStatement?: { total: number; closingDate: string } }[];
    const card = rows.find((r) => r.id === f.card)!;
    expect(card.openStatement).toMatchObject({ total: 42, count: 1 });
    expect(card.openStatement!.closingDate >= ymd).toBe(true);
    expect(rows.filter((r) => r.id !== f.card).every((r) => !("openStatement" in r))).toBe(true);
  });

  it("reads today in the user's timezone", () => {
    const lateNight = new Date("2026-10-06T02:30:00Z"); // 23:30 on the 5th in São Paulo
    expect(userCalendarDay("America/Sao_Paulo", lateNight).toISOString()).toBe("2026-10-05T12:00:00.000Z");
    expect(userCalendarDay("Asia/Tokyo", lateNight).toISOString()).toBe("2026-10-06T12:00:00.000Z");
    expect(userCalendarDay("Not/AZone", lateNight).toISOString()).toBe("2026-10-06T12:00:00.000Z");
  });
});

describe("POST /v2/accounts/{id}/set-balance", () => {
  it("moves the initial balance so the balance matches, as one undoable batch", async () => {
    await call("POST", "/v2/ledger/entries", { kind: "expense", accountId: f.broker, amount: 100, date: "2026-09-01", description: "Taxa" });
    const set = await call("POST", `/v2/accounts/${f.broker}/set-balance`, { balance: 1500.25 });
    expect(set.status).toBe(200);
    expect(set.body).toMatchObject({ id: f.broker, balance: 1500.25, initialBalance: 1600.25, batchId: expect.any(String) });
    const listed = ((await call("GET", "/v2/accounts")).body as { id: string; balance: number }[]).find((a) => a.id === f.broker);
    expect(listed?.balance).toBe(1500.25);

    expect((await call("POST", `/v2/accounts/${f.broker}/set-balance`, { balance: 1500.25 })).body).toMatchObject({ batchId: null, balance: 1500.25 });

    expect((await call("POST", `/v2/mutations/${set.body.batchId}/undo`, {})).status).toBe(200);
    expect(Number((await prisma.account.findUniqueOrThrow({ where: { id: f.broker } })).initialBalance)).toBe(0);
  });

  it("is 404 for another user's account and 422 without a number", async () => {
    const other = await createLedgerFixture(prisma, OTHER);
    expect((await call("POST", `/v2/accounts/${other.broker}/set-balance`, { balance: 1 })).body).toMatchObject({ code: "account.not_found" });
    expect((await call("POST", `/v2/accounts/${f.broker}/set-balance`, { balance: "1" })).status).toBe(422);
  });
});

describe("PATCH /v2/accounts/{id}", () => {
  it("changes the currency only while the account has no entries", async () => {
    const free = await call("PATCH", `/v2/accounts/${f.broker}`, { currency: "usd" });
    expect(free.status).toBe(200);
    expect(free.body).toMatchObject({ currency: "USD", batchId: null });

    await purchase(10, "2026-09-10");
    const locked = await call("PATCH", `/v2/accounts/${f.card}`, { currency: "USD" });
    expect(locked).toEqual({
      status: 422,
      body: expect.objectContaining({ code: "account.currency_locked", params: { count: 1, currency: "BRL" } }),
    });
    // Sending the same currency back is not a change.
    expect((await call("PATCH", `/v2/accounts/${f.card}`, { currency: "BRL", name: "Nubank Ultravioleta" })).status).toBe(200);
  });

  it("counts trashed entries too, since a restore brings them back", async () => {
    const created = await purchase(10, "2026-09-10");
    await call("DELETE", `/v2/ledger/entries/${created.body.entryIds[0]}`);
    expect((await call("PATCH", `/v2/accounts/${f.card}`, { currency: "USD" })).body).toMatchObject({ code: "account.currency_locked" });
  });

  it("moves an account to another entity only while nothing is booked on it", async () => {
    const moved = await call("PATCH", `/v2/accounts/${f.broker}`, { entityId: f.pjId });
    expect(moved).toMatchObject({ status: 200, body: { entityId: f.pjId, batchId: null } });

    await purchase(10, "2026-09-10");
    expect((await call("PATCH", `/v2/accounts/${f.card}`, { entityId: f.pjId })).body).toMatchObject({ code: "account.entity_locked", params: { entries: 1, recurring: 0 } });
    expect((await call("PATCH", `/v2/accounts/${f.pfChecking}`, { entityId: f.pjId })).body).toMatchObject({ code: "account.default_entity_locked" });
    const other = await createLedgerFixture(prisma, OTHER);
    expect((await call("PATCH", `/v2/accounts/${f.broker}`, { entityId: other.pjId })).body).toMatchObject({ code: "entity.not_found" });
    expect((await prisma.account.findUniqueOrThrow({ where: { id: f.card } })).entityId).toBe(f.pfId);
  });

  it("refuses to move an account a recurring rule books on", async () => {
    await prisma.recurringRule.create({
      data: { userId: USER, entityId: f.pfId, accountId: f.broker, kind: "expense", description: "Custódia", amount: 10, currency: "BRL", frequency: "monthly", startDate: new Date("2027-09-01T12:00:00Z"), nextDueDate: new Date("2027-09-01T12:00:00Z"), autoGenerate: false },
    });
    expect((await call("PATCH", `/v2/accounts/${f.broker}`, { entityId: f.pjId })).body).toMatchObject({ code: "account.entity_locked", params: { entries: 0, recurring: 1 } });
  });

  it("records other edits as an undoable batch", async () => {
    const renamed = await call("PATCH", `/v2/accounts/${f.card}`, { name: "Nubank Roxinho", creditLimit: 15000 });
    expect(renamed.body).toMatchObject({ name: "Nubank Roxinho", creditLimit: 15000, batchId: expect.any(String) });
    expect((await call("POST", `/v2/mutations/${renamed.body.batchId}/undo`, {})).status).toBe(200);
    expect(await prisma.account.findUniqueOrThrow({ where: { id: f.card } })).toMatchObject({ name: "Nubank" });

    const archived = await call("PATCH", `/v2/accounts/${f.broker}`, { archived: true });
    expect(archived.body).toMatchObject({ archivedAt: expect.any(String), batchId: expect.any(String) });
    await call("POST", `/v2/mutations/${archived.body.batchId}/undo`, {});
    expect((await prisma.account.findUniqueOrThrow({ where: { id: f.broker } })).archivedAt).toBeNull();
  });
});
