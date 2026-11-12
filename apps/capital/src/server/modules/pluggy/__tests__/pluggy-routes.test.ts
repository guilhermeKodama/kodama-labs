import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createApp } from "@capital/server/lib/create-app";
import { createEntry } from "@capital/server/modules/ledger/services/entries";
import { createHolding } from "@capital/server/modules/investments/services/portfolio";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import type { IncomeGuesser } from "../lib/classify";
import type { PluggyClient } from "../lib/types";

const state = vi.hoisted(() => ({
  enabled: false,
  client: undefined as unknown as PluggyClient,
  guesser: null as unknown as IncomeGuesser | null,
}));
vi.mock("../lib/config", () => ({ isPluggyConfigured: () => state.enabled }));
vi.mock("../lib/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("../lib/client")>()), createPluggyClient: () => state.client }));
vi.mock("../lib/guesser", () => ({ anthropicIncomeGuesser: () => state.guesser }));

const USER = "test-user-pluggy-routes-001";
const OTHER = "test-user-pluggy-routes-002";
const MISSING = "00000000-0000-0000-0000-000000000000";
const ITEM_UUID = "11111111-1111-4111-8111-111111111111";
const app = createApp();

let f: LedgerFixture;
let other: LedgerFixture;
let cookie: string;
let otherCookie: string;

const login = async (userId: string) => `capital_session=${(await prisma.session.create({ data: { userId, expiresAt: new Date(Date.now() + 3600_000) } })).id}`;

async function call(method: string, path: string, body?: unknown, as: string | null = cookie) {
  const res = await app.request(`/api${path}`, {
    method,
    headers: { ...(as && { cookie: as }), ...(body !== undefined && { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

beforeEach(async () => {
  other = await createLedgerFixture(prisma, OTHER);
  otherCookie = await login(OTHER);
  state.enabled = false;
  state.guesser = null;
  state.client = {
    getItem: async () => ({ id: ITEM_UUID, status: "UPDATED", consentExpiresAt: "2027-06-01T00:00:00.000Z" }),
    getAccounts: async () => [],
    getTransactions: async () => [],
    getInvestments: async () => [],
    getInvestmentTransactions: async () => [],
  };
  f = await createLedgerFixture(prisma, USER);
  cookie = await login(USER);
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
  await deleteLedgerFixture(prisma, OTHER);
});

const newItem = (data: { userId?: string; itemId?: string } = {}) =>
  prisma.pluggyItem.create({ data: { userId: data.userId ?? USER, label: "Nubank", itemId: data.itemId ?? ITEM_UUID, entityKind: "personal" } });

describe("authentication", () => {
  it("answers 401 to every Pluggy route without a session", async () => {
    const calls: [string, string, unknown?][] = [
      ["GET", "/v2/pluggy"],
      ["POST", "/v2/pluggy/items", { label: "x", itemId: ITEM_UUID, entityKind: "personal" }],
      ["PATCH", `/v2/pluggy/items/${MISSING}`, { label: "x" }],
      ["DELETE", `/v2/pluggy/items/${MISSING}`],
      ["PATCH", `/v2/pluggy/links/${MISSING}`, { capitalAccountId: null }],
      ["POST", "/v2/pluggy/sync", {}],
      ["POST", `/v2/pluggy/reviews/${MISSING}`, { action: "ignore" }],
    ];
    for (const [method, path, body] of calls) {
      expect((await call(method, path, body, null)).status, `${method} ${path}`).toBe(401);
    }
  });
});

describe("GET /v2/pluggy", () => {
  it("reports whether the integration is on and lists only the caller's connections and open reviews", async () => {
    state.enabled = true;
    const mine = await newItem();
    await newItem({ userId: OTHER, itemId: "22222222-2222-4222-8222-222222222222" });
    await prisma.pluggyReview.create({ data: { userId: USER, itemRowId: mine.id, kind: "conflict", draft: { reason: "ambiguous" } } });
    await prisma.pluggyReview.create({ data: { userId: OTHER, kind: "conflict", draft: { reason: "other" } } });

    const { status, body } = await call("GET", "/v2/pluggy");

    expect(status).toBe(200);
    expect(body.enabled).toBe(true);
    expect(body.items.map((item: { id: string }) => item.id)).toEqual([mine.id]);
    expect(body.reviews).toHaveLength(1);
    expect(body.reviews[0]).toMatchObject({ itemRowId: mine.id, kind: "conflict", status: "open", draft: { reason: "ambiguous" } });
    state.enabled = false;
    expect((await call("GET", "/v2/pluggy")).body.enabled).toBe(false);
  });
});

describe("connections", () => {
  it("creates one, then updates it, then deletes it", async () => {
    const created = await call("POST", "/v2/pluggy/items", { label: " Meu banco ", itemId: ITEM_UUID, entityKind: "personal" });
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({ label: "Meu banco", itemId: ITEM_UUID, entityKind: "personal", status: "idle", userId: USER });
    const id = created.body.id as string;

    const patched = await call("PATCH", `/v2/pluggy/items/${id}`, { label: "Renomeado", brokerageAccountId: f.broker, syncCutoff: "2026-05-04" });
    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({ label: "Renomeado", brokerageAccountId: f.broker });
    expect(patched.body.syncCutoff).toBe("2026-05-04T12:00:00.000Z");

    expect((await call("PATCH", `/v2/pluggy/items/${id}`, { syncCutoff: null, brokerageAccountId: null })).body).toMatchObject({ syncCutoff: null, brokerageAccountId: null });

    expect(await call("DELETE", `/v2/pluggy/items/${id}`)).toEqual({ status: 200, body: { ok: true } });
    expect(await prisma.pluggyItem.count({ where: { id } })).toBe(0);
    expect(await call("DELETE", `/v2/pluggy/items/${id}`)).toMatchObject({ status: 404, body: { code: "pluggy.not_found" } });
  });

  it("rejects bad input with the coded error envelope", async () => {
    const badId = await call("POST", "/v2/pluggy/items", { label: "x", itemId: "not-a-uuid", entityKind: "personal" });
    expect(badId).toMatchObject({ status: 422, body: { code: "pluggy.item_id" } });
    const noLabel = await call("POST", "/v2/pluggy/items", { label: "", itemId: ITEM_UUID, entityKind: "personal" });
    expect(noLabel).toMatchObject({ status: 422, body: { code: "validation" } });
    const badKind = await call("POST", "/v2/pluggy/items", { label: "x", itemId: ITEM_UUID, entityKind: "family" });
    expect(badKind.status).toBe(422);
    const blank = await call("POST", "/v2/pluggy/items", { label: "   ", itemId: ITEM_UUID, entityKind: "personal" });
    expect(blank).toMatchObject({ status: 422, body: { code: "pluggy.label" } });
    const item = await newItem();
    const badCutoff = await call("PATCH", `/v2/pluggy/items/${item.id}`, { syncCutoff: "04/05/2026" });
    expect(badCutoff).toMatchObject({ status: 422, body: { code: "validation" } });
    expect(await prisma.pluggyItem.count({ where: { userId: USER } })).toBe(1);
  });

  it("answers 404 for a connection that belongs to someone else", async () => {
    const foreign = await newItem({ userId: OTHER });
    expect(await call("PATCH", `/v2/pluggy/items/${foreign.id}`, { label: "x" })).toMatchObject({ status: 404, body: { code: "pluggy.not_found" } });
    expect(await call("DELETE", `/v2/pluggy/items/${foreign.id}`)).toMatchObject({ status: 404, body: { code: "pluggy.not_found" } });
    expect(await prisma.pluggyItem.findUniqueOrThrow({ where: { id: foreign.id } })).toMatchObject({ label: "Nubank" });
  });

  it("maps and unmaps an account, and refuses the wrong kind of account", async () => {
    const item = await newItem();
    const bank = await prisma.pluggyAccountLink.create({ data: { itemRowId: item.id, pluggyAccountId: "acc-1", name: "Conta", type: "BANK" } });

    expect((await call("PATCH", `/v2/pluggy/links/${bank.id}`, { capitalAccountId: f.pfChecking })).body).toMatchObject({ id: bank.id, capitalAccountId: f.pfChecking });
    expect((await call("PATCH", `/v2/pluggy/links/${bank.id}`, { capitalAccountId: null })).body.capitalAccountId).toBeNull();
    expect(await call("PATCH", `/v2/pluggy/links/${bank.id}`, { capitalAccountId: f.card })).toMatchObject({ status: 422, body: { code: "pluggy.account_type" } });
    expect(await call("PATCH", `/v2/pluggy/links/${bank.id}`, { capitalAccountId: other.pfChecking })).toMatchObject({ status: 404, body: { code: "account.not_found" } });
    expect(await call("PATCH", `/v2/pluggy/links/${MISSING}`, { capitalAccountId: null })).toMatchObject({ status: 404, body: { code: "pluggy.link_not_found" } });
    expect(await call("PATCH", `/v2/pluggy/links/${bank.id}`, {})).toMatchObject({ status: 422 });
  });
});

describe("POST /v2/pluggy/sync", () => {
  it("is disabled without credentials and writes nothing", async () => {
    const item = await newItem();
    expect(await call("POST", "/v2/pluggy/sync", {})).toEqual({ status: 200, body: { status: "disabled", runs: [] } });
    expect(await prisma.pluggySyncRun.count({ where: { itemRowId: item.id } })).toBe(0);
  });

  it("is idle when the caller has no connection, or not that one", async () => {
    state.enabled = true;
    expect((await call("POST", "/v2/pluggy/sync", {})).body).toEqual({ status: "idle", runs: [] });
    const foreign = await newItem({ userId: OTHER });
    expect((await call("POST", "/v2/pluggy/sync", { itemRowId: foreign.id })).body).toEqual({ status: "idle", runs: [] });
    await newItem();
    expect((await call("POST", "/v2/pluggy/sync", { itemRowId: MISSING })).body).toEqual({ status: "idle", runs: [] });
  });

  it("starts the run, answers at once with its id and finishes it in the background", async () => {
    state.enabled = true;
    const item = await newItem();
    await prisma.pluggyAccountLink.create({ data: { itemRowId: item.id, pluggyAccountId: "acc-1", name: "Conta", type: "BANK", capitalAccountId: f.pfChecking } });
    state.client = {
      ...state.client,
      getAccounts: async () => [{ id: "acc-1", type: "BANK", name: "Conta", number: "0012345678" }],
      getTransactions: async () => [{ id: "tx-route", accountId: "acc-1", type: "DEBIT", amount: 12.3, date: new Date(Date.now() - 86_400_000).toISOString(), description: "Café", status: "POSTED" }],
    };

    const { status, body } = await call("POST", "/v2/pluggy/sync", { itemRowId: item.id });

    expect(status).toBe(200);
    expect(body.status).toBe("started");
    expect(body.runs).toEqual([{ id: expect.any(String), itemId: item.id, status: "running" }]);
    const run = await vi.waitFor(
      async () => {
        const row = await prisma.pluggySyncRun.findUniqueOrThrow({ where: { id: body.runs[0].id } });
        expect(row.status).not.toBe("running");
        // The run row is closed first and the connection released right after.
        expect((await prisma.pluggyItem.findUniqueOrThrow({ where: { id: item.id } })).syncingAt).toBeNull();
        return row;
      },
      { timeout: 10_000, interval: 50 },
    );
    expect(run).toMatchObject({ status: "ok", trigger: "manual" });
    expect(await prisma.ledgerEntry.count({ where: { userId: USER, description: "Café" } })).toBe(1);
    expect((await call("GET", "/v2/pluggy")).body.items[0]).toMatchObject({ id: item.id, status: "ok", syncing: false });
  });

  it("passes the income guesser to the sync so a doubtful income waits for review", async () => {
    state.enabled = true;
    const item = await prisma.pluggyItem.create({ data: { userId: USER, label: "Corretora", itemId: ITEM_UUID, entityKind: "personal", brokerageAccountId: f.broker } });
    const guess = vi.fn<IncomeGuesser>(async () => ({ incomeType: "dividend", origin: "BR", confidence: 0.2 }));
    state.guesser = guess;
    state.client = {
      ...state.client,
      getInvestments: async () => [{ id: "inv-x", type: "OTHER", subtype: "OTHER", name: "Fundo X", code: "ZZTOP" }],
      getInvestmentTransactions: async () => [
        { id: "itx-x", type: "INTEREST", amount: 9, description: "Distribuição", date: new Date(Date.now() - 86_400_000).toISOString() },
      ],
    };

    const { body } = await call("POST", "/v2/pluggy/sync", { itemRowId: item.id });
    await vi.waitFor(async () => {
      expect((await prisma.pluggySyncRun.findUniqueOrThrow({ where: { id: body.runs[0].id } })).status).not.toBe("running");
      expect((await prisma.pluggyItem.findUniqueOrThrow({ where: { id: item.id } })).syncingAt).toBeNull();
    });

    expect(guess).toHaveBeenCalledTimes(1);
    expect(await prisma.pluggyReview.count({ where: { userId: USER, kind: "low_confidence", status: "open" } })).toBe(1);
    expect(await prisma.investmentOperation.count({ where: { holding: { account: { userId: USER } } } })).toBe(0);
  });
});

describe("POST /v2/pluggy/reviews/:id", () => {
  const review = (draft: object, userId = USER, kind = "conflict") => prisma.pluggyReview.create({ data: { userId, kind, draft } });

  it("ignores a review and returns the closed row", async () => {
    const row = await review({ pluggyId: "tx-1" });
    const { status, body } = await call("POST", `/v2/pluggy/reviews/${row.id}`, { action: "ignore" });
    expect(status).toBe(200);
    expect(body).toMatchObject({ id: row.id, status: "ignored" });
    expect(body.resolvedAt).toEqual(expect.any(String));
  });

  it("links a review to an entry of the caller's and remembers the Pluggy id", async () => {
    const row = await review({ pluggyId: "tx-link" });
    const entry = await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 9, date: "2026-10-10", description: "Manual" }, prisma);

    expect(await call("POST", `/v2/pluggy/reviews/${row.id}`, { action: "link" })).toMatchObject({ status: 422, body: { code: "pluggy.link_target" } });
    expect(await call("POST", `/v2/pluggy/reviews/${row.id}`, { action: "link", ledgerEntryId: MISSING })).toMatchObject({ status: 404, body: { code: "entry.not_found" } });
    const linked = await call("POST", `/v2/pluggy/reviews/${row.id}`, { action: "link", ledgerEntryId: entry.entryIds[0] });
    expect(linked.body.status).toBe("resolved");
    expect(await prisma.pluggyExternalRef.findUniqueOrThrow({ where: { userId_pluggyId: { userId: USER, pluggyId: "tx-link" } } })).toMatchObject({ ledgerEntryId: entry.entryIds[0], matchKind: "linked" });
  });

  it("confirms a low-confidence income with the type and origin the user picked", async () => {
    const holding = await createHolding(USER, { accountId: f.broker, assetClass: "stocks", ticker: "PETR4", name: "Petrobras", currency: "BRL" }, prisma);
    const row = await review({ event: "income", pluggyId: "tx-confirm", holdingId: holding.id, incomeType: "jcp", gross: 50, taxWithheld: 0, date: "2026-10-10" }, USER, "low_confidence");

    const wrong = await call("POST", `/v2/pluggy/reviews/${row.id}`, { action: "confirm", incomeType: "salary" });
    expect(wrong).toMatchObject({ status: 422, body: { code: "validation" } });
    const confirmed = await call("POST", `/v2/pluggy/reviews/${row.id}`, { action: "confirm", incomeType: "dividend", origin: "EXTERIOR" });

    expect(confirmed.body.status).toBe("resolved");
    expect(await prisma.investmentOperation.findFirstOrThrow({ where: { holdingId: holding.id } })).toMatchObject({ incomeType: "dividend", dividendOrigin: "EXTERIOR", classificationSource: "manual", syncLocked: true });
  });

  it("accepts a null origin, rejects an unknown action and answers 404 for a missing or foreign review", async () => {
    const row = await review({ pluggyId: "tx-null" });
    expect((await call("POST", `/v2/pluggy/reviews/${row.id}`, { action: "ignore", origin: null })).status).toBe(200);
    expect(await call("POST", `/v2/pluggy/reviews/${row.id}`, { action: "delete" })).toMatchObject({ status: 422, body: { code: "validation" } });
    const foreign = await review({ pluggyId: "tx-foreign" }, OTHER);
    expect(await call("POST", `/v2/pluggy/reviews/${foreign.id}`, { action: "ignore" })).toMatchObject({ status: 404, body: { code: "pluggy.review_not_found" } });
    expect(await call("POST", `/v2/pluggy/reviews/${MISSING}`, { action: "ignore" }, otherCookie)).toMatchObject({ status: 404, body: { code: "pluggy.review_not_found" } });
    expect((await prisma.pluggyReview.findUniqueOrThrow({ where: { id: foreign.id } })).status).toBe("open");
  });
});
