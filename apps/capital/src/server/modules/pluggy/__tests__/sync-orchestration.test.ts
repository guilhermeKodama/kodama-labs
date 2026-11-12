import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createHolding } from "@capital/server/modules/investments/services/portfolio";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import snapshot from "./fixtures/pluggy-snapshot.json";
import { onOrAfter } from "../lib/consent";
import type { PluggyAccount, PluggyClient, PluggyInvestment, PluggyInvestmentTransaction, PluggyItemPayload, PluggyTransaction } from "../lib/types";

const configured = vi.hoisted(() => ({ value: true }));
vi.mock("../lib/config", () => ({ isPluggyConfigured: () => configured.value }));

import { startPluggySync, syncPluggy, type SyncDeps } from "../services/sync";

const NOW = new Date("2026-10-19T15:00:00.000Z");
const USER = "test-user-pluggy-orchestration-001";
const ITEM_UUID = "11111111-1111-4111-8111-111111111111";

type FixtureInvestmentTx = PluggyInvestmentTransaction & { investmentId: string };

const checking = snapshot.accounts[0] as PluggyAccount;
const debit = snapshot.transactions[0] as PluggyTransaction;
const investments = snapshot.investments as PluggyInvestment[];
const investmentTxs = snapshot.investmentTransactions as FixtureInvestmentTx[];

let f: LedgerFixture;

beforeEach(async () => {
  configured.value = true;
  f = await createLedgerFixture(prisma, USER);
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

function fake(opts: {
  item?: Partial<PluggyItemPayload>;
  accounts?: PluggyAccount[];
  transactions?: PluggyTransaction[];
  investments?: PluggyInvestment[];
  investmentTransactions?: FixtureInvestmentTx[];
  failItem?: Error;
}) {
  const calls = { item: 0, accounts: 0, investments: 0 };
  const client: PluggyClient = {
    async getItem() {
      calls.item += 1;
      if (opts.failItem) throw opts.failItem;
      return { ...(snapshot.item as PluggyItemPayload), ...opts.item };
    },
    async getAccounts() {
      calls.accounts += 1;
      return opts.accounts ?? [];
    },
    async getTransactions(accountId, since) {
      return (opts.transactions ?? []).filter((row) => onOrAfter(row.date, since) && (!row.accountId || row.accountId === accountId));
    },
    async getInvestments() {
      calls.investments += 1;
      return opts.investments ?? [];
    },
    async getInvestmentTransactions(investmentId, since) {
      return (opts.investmentTransactions ?? []).filter((row) => row.investmentId === investmentId && onOrAfter(row.tradeDate ?? row.date, since));
    },
  };
  return { client, calls };
}

const deps = (client: PluggyClient, extra: Partial<SyncDeps> = {}): SyncDeps => ({ db: prisma, client, now: NOW, guesser: null, ...extra });

const newItem = (data: { itemId?: string; label?: string; brokerageAccountId?: string | null; syncingAt?: Date | null; createdAt?: Date } = {}) =>
  prisma.pluggyItem.create({
    data: {
      userId: USER,
      label: data.label ?? "Nubank",
      itemId: data.itemId ?? ITEM_UUID,
      entityKind: "personal",
      brokerageAccountId: data.brokerageAccountId === undefined ? null : data.brokerageAccountId,
      syncingAt: data.syncingAt ?? null,
      ...(data.createdAt && { createdAt: data.createdAt }),
    },
  });

const mapChecking = (itemRowId: string, capitalAccountId: string) =>
  prisma.pluggyAccountLink.create({ data: { itemRowId, pluggyAccountId: checking.id, name: "pending", type: "BANK", capitalAccountId } });

/** Waits for the background run to end: its row is closed first and the connection released right after. */
async function finished(runId: string) {
  return vi.waitFor(
    async () => {
      const run = await prisma.pluggySyncRun.findUniqueOrThrow({ where: { id: runId } });
      expect(run.status).not.toBe("running");
      expect((await prisma.pluggyItem.findUniqueOrThrow({ where: { id: run.itemRowId } })).syncingAt).toBeNull();
      return run;
    },
    { timeout: 10_000, interval: 50 },
  );
}

describe("sync entry points", () => {
  it("do nothing and write nothing when the integration is off, whether it is told so or reads the configuration", async () => {
    const item = await newItem();
    const { client, calls } = fake({ accounts: [checking], transactions: [debit] });

    expect(await syncPluggy(USER, deps(client, { enabled: false }), { trigger: "cron" })).toEqual({ status: "disabled", items: [] });
    expect(await startPluggySync(USER, deps(client, { enabled: false }))).toEqual({ status: "disabled", runs: [] });
    configured.value = false;
    expect(await syncPluggy(USER, deps(client), { trigger: "cron" })).toEqual({ status: "disabled", items: [] });
    expect(await startPluggySync(USER, deps(client))).toEqual({ status: "disabled", runs: [] });

    expect(calls.item).toBe(0);
    expect(await prisma.pluggySyncRun.count({ where: { itemRowId: item.id } })).toBe(0);
  });

  it("read the configuration when the caller does not say, and an explicit flag wins over it", async () => {
    await newItem();
    const { client } = fake({});
    configured.value = true;
    expect((await syncPluggy(USER, deps(client), { trigger: "cron" })).status).toBe("ok");
    configured.value = false;
    expect((await syncPluggy(USER, deps(client, { enabled: true }), { trigger: "cron" })).status).toBe("ok");
  });

  it("report idle for a user with no connections, or when the requested connection is not theirs", async () => {
    const { client, calls } = fake({});
    expect(await syncPluggy(USER, deps(client), { trigger: "manual" })).toEqual({ status: "idle", items: [] });
    expect(await startPluggySync(USER, deps(client))).toEqual({ status: "idle", runs: [] });
    await newItem();
    expect(await syncPluggy(USER, deps(client), { trigger: "manual", itemRowId: "00000000-0000-0000-0000-000000000000" })).toEqual({ status: "idle", items: [] });
    expect(await startPluggySync(USER, deps(client), { itemRowId: "00000000-0000-0000-0000-000000000000" })).toEqual({ status: "idle", runs: [] });
    expect(calls.item).toBe(0);
  });

  it("syncs every connection oldest first, or only the one asked for", async () => {
    const first = await newItem({ label: "A", createdAt: new Date("2026-01-01T00:00:00Z") });
    const second = await newItem({ label: "B", itemId: "22222222-2222-4222-8222-222222222222", createdAt: new Date("2026-02-01T00:00:00Z") });
    const { client, calls } = fake({});

    const all = await syncPluggy(USER, deps(client), { trigger: "cron" });
    expect(all.items.map((item) => item.id)).toEqual([first.id, second.id]);
    expect(calls.item).toBe(2);

    const only = await syncPluggy(USER, deps(client), { trigger: "manual", itemRowId: second.id });
    expect(only.items.map((item) => item.id)).toEqual([second.id]);
    expect(calls.item).toBe(3);
    const runs = await prisma.pluggySyncRun.findMany({ where: { itemRowId: second.id }, orderBy: { startedAt: "asc" } });
    expect(runs.map((run) => run.trigger)).toEqual(["cron", "manual"]);
  });

  it("start returns the run ids at once and finishes the work in the background", async () => {
    const item = await newItem({ brokerageAccountId: null });
    await mapChecking(item.id, f.pfChecking);
    const recent = { ...debit, id: "tx-start", date: "2026-10-16T12:00:00.000Z" };
    const { client } = fake({ accounts: [checking], transactions: [recent] });

    const started = await startPluggySync(USER, deps(client), { itemRowId: item.id });

    expect(started.status).toBe("started");
    expect(started.runs).toEqual([{ id: expect.any(String), itemId: item.id, status: "running" }]);
    const run = await finished(started.runs[0]!.id);
    expect(run).toMatchObject({ status: "ok", trigger: "manual", error: null });
    expect(run.finishedAt?.toISOString()).toBe(NOW.toISOString());
    expect(run.stats).toMatchObject({ created: 1, linked: 0, skipped: 0, conflicts: 0 });
    expect(await prisma.ledgerEntry.count({ where: { userId: USER, description: "PIX mercado" } })).toBe(1);
    const stored = await prisma.pluggyItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(stored).toMatchObject({ status: "ok", syncingAt: null });
    expect(stored.lastSuccessAt?.toISOString()).toBe(NOW.toISOString());
  });

  it("start marks a busy connection skipped without reading from Pluggy, and takes over a lock older than 15 minutes", async () => {
    const busy = await newItem({ syncingAt: new Date(NOW.getTime() - 14 * 60_000) });
    const stale = await newItem({ itemId: "22222222-2222-4222-8222-222222222222", syncingAt: new Date(NOW.getTime() - 16 * 60_000) });
    const { client, calls } = fake({});

    const started = await startPluggySync(USER, deps(client));

    const byItem = new Map(started.runs.map((run) => [run.itemId, run]));
    expect(byItem.get(busy.id)?.status).toBe("skipped");
    expect(byItem.get(stale.id)?.status).toBe("running");
    const skipped = await prisma.pluggySyncRun.findUniqueOrThrow({ where: { id: byItem.get(busy.id)!.id } });
    expect(skipped).toMatchObject({ status: "skipped", error: "busy" });
    expect(skipped.finishedAt?.toISOString()).toBe(NOW.toISOString());
    expect((await prisma.pluggyItem.findUniqueOrThrow({ where: { id: busy.id } })).syncingAt?.toISOString()).toBe(new Date(NOW.getTime() - 14 * 60_000).toISOString());
    await finished(byItem.get(stale.id)!.id);
    expect(calls.item).toBe(1);
    expect((await prisma.pluggyItem.findUniqueOrThrow({ where: { id: stale.id } })).syncingAt).toBeNull();
  });
});

describe("a sync that fails", () => {
  it("records the error with long numbers redacted, releases the lock and does not count as a success", async () => {
    const item = await newItem();
    const { client } = fake({ failItem: new Error("Pluggy request failed for account 001234567890") });

    const report = await syncPluggy(USER, deps(client), { trigger: "cron" });

    expect(report.status).toBe("ok");
    expect(report.items[0]).toMatchObject({ id: item.id, status: "error", error: "Pluggy request failed for account ••••", stats: { created: 0 } });
    const stored = await prisma.pluggyItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(stored).toMatchObject({ status: "error", lastError: "Pluggy request failed for account ••••", syncingAt: null, lastSuccessAt: null });
    expect(stored.lastSyncAt?.toISOString()).toBe(NOW.toISOString());
    const run = await prisma.pluggySyncRun.findUniqueOrThrow({ where: { id: report.items[0]!.runId! } });
    expect(run).toMatchObject({ status: "error", error: "Pluggy request failed for account ••••" });

    // The lock is gone, so the next run goes through and clears the error.
    const retry = await syncPluggy(USER, deps(fake({}).client), { trigger: "cron" });
    expect(retry.items[0]?.status).toBe("ok");
    expect(await prisma.pluggyItem.findUniqueOrThrow({ where: { id: item.id } })).toMatchObject({ status: "ok", lastError: null });
  });

  it("start also ends the run in error when the background work throws", async () => {
    const item = await newItem();
    const started = await startPluggySync(USER, deps(fake({ failItem: new Error("down") }).client), { itemRowId: item.id });
    const run = await finished(started.runs[0]!.id);
    expect(run).toMatchObject({ status: "error", error: "down" });
    expect(await prisma.pluggyItem.findUniqueOrThrow({ where: { id: item.id } })).toMatchObject({ status: "error", lastError: "down", syncingAt: null });
  });

  it("uses a generic message when something other than an Error was thrown", async () => {
    const item = await newItem();
    const client = fake({}).client;
    client.getItem = async () => {
      throw "a string 123456789";
    };
    const report = await syncPluggy(USER, deps(client), { trigger: "cron" });
    expect(report.items[0]).toMatchObject({ status: "error", error: "sync failed" });
    expect((await prisma.pluggyItem.findUniqueOrThrow({ where: { id: item.id } })).lastError).toBe("sync failed");
  });
});

describe("consent", () => {
  it("stores the consent date the item reports and keeps the old one when a later read has none", async () => {
    const item = await newItem();
    await syncPluggy(USER, deps(fake({ item: { consentExpiresAt: "2027-03-04T00:00:00.000Z" } }).client), { trigger: "cron" });
    expect((await prisma.pluggyItem.findUniqueOrThrow({ where: { id: item.id } })).consentExpiresAt?.toISOString()).toBe("2027-03-04T00:00:00.000Z");

    await syncPluggy(USER, deps(fake({ item: { consentExpiresAt: null } }).client), { trigger: "cron" });
    const stored = await prisma.pluggyItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(stored.consentExpiresAt?.toISOString()).toBe("2027-03-04T00:00:00.000Z");
    expect(stored.status).toBe("ok");
  });

  it("records an expired consent as its own status without a success", async () => {
    const item = await newItem();
    const report = await syncPluggy(USER, deps(fake({ item: { status: "LOGIN_ERROR", error: { code: "USER_AUTHORIZATION_EXPIRED" }, consentExpiresAt: "2026-10-01T00:00:00.000Z" } }).client), { trigger: "cron" });
    expect(report.items[0]).toMatchObject({ status: "expired", stats: { created: 0, linked: 0, skipped: 0, conflicts: 0, unmapped: 0 } });
    const stored = await prisma.pluggyItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(stored).toMatchObject({ status: "expired", lastSuccessAt: null, syncingAt: null });
    expect(stored.consentExpiresAt?.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect((await prisma.pluggySyncRun.findUniqueOrThrow({ where: { id: report.items[0]!.runId! } })).status).toBe("expired");
  });

  it("books the run as ok but the item as expiring inside the warning window", async () => {
    const item = await newItem();
    const report = await syncPluggy(USER, deps(fake({ item: { status: "UPDATED", error: null, consentExpiresAt: "2026-11-01T00:00:00.000Z" } }).client), { trigger: "cron" });
    expect(report.items[0]?.status).toBe("expiring");
    expect((await prisma.pluggySyncRun.findUniqueOrThrow({ where: { id: report.items[0]!.runId! } })).status).toBe("ok");
    const stored = await prisma.pluggyItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(stored.status).toBe("expiring");
    expect(stored.lastSuccessAt?.toISOString()).toBe(NOW.toISOString());
  });
});

describe("account discovery", () => {
  it("updates a known account's label, type, subtype and currency in place, and clears what Pluggy no longer sends", async () => {
    const item = await newItem({ brokerageAccountId: f.broker });
    await prisma.pluggyAccountLink.create({
      data: { itemRowId: item.id, pluggyAccountId: "acc-known", name: "Nome antigo", type: "BANK", subtype: "CHECKING_ACCOUNT", currency: "BRL", numberLast4: "1111", capitalAccountId: f.pfChecking },
    });

    await syncPluggy(USER, deps(fake({ accounts: [{ id: "acc-known", type: "CREDIT", name: "Cartão novo", marketingName: "", number: "000099992222" }] }).client), { trigger: "cron" });

    const link = await prisma.pluggyAccountLink.findFirstOrThrow({ where: { itemRowId: item.id, pluggyAccountId: "acc-known" } });
    expect(link).toMatchObject({ name: "Cartão novo ••••2222", type: "CREDIT", subtype: null, currency: null, numberLast4: "2222", capitalAccountId: f.pfChecking });
    expect(await prisma.pluggyAccountLink.count({ where: { itemRowId: item.id } })).toBe(1);
  });

  it("prefers the marketing name, and stores an unmapped link when no earlier account shares the last digits", async () => {
    const item = await newItem({ brokerageAccountId: f.broker });
    await prisma.pluggyAccountLink.create({ data: { itemRowId: item.id, pluggyAccountId: "acc-other", name: "Outra", type: "BANK", numberLast4: "7777", capitalAccountId: null } });
    await prisma.pluggyAccountLink.create({ data: { itemRowId: item.id, pluggyAccountId: "acc-card", name: "Cartão", type: "CREDIT", numberLast4: "4444", capitalAccountId: f.card } });

    const report = await syncPluggy(
      USER,
      deps(
        fake({
          accounts: [
            { id: "acc-new", type: "BANK", name: "Conta corrente", marketingName: "Conta Ouro", number: "000044440000", subtype: "SAVINGS_ACCOUNT", currencyCode: "BRL" },
            { id: "acc-nodigits", type: "BANK", name: "Sem número" },
            { id: "acc-same-digits-other-type", type: "BANK", name: "Mesmo final", number: "55554444" },
          ],
        }).client,
      ),
      { trigger: "cron" },
    );

    const links = await prisma.pluggyAccountLink.findMany({ where: { itemRowId: item.id }, orderBy: { pluggyAccountId: "asc" } });
    const byId = new Map(links.map((link) => [link.pluggyAccountId, link]));
    expect(byId.get("acc-new")).toMatchObject({ name: "Conta Ouro ••••0000", subtype: "SAVINGS_ACCOUNT", currency: "BRL", numberLast4: "0000", capitalAccountId: null });
    expect(byId.get("acc-nodigits")).toMatchObject({ name: "Sem número", subtype: null, currency: null, numberLast4: null, capitalAccountId: null });
    // Same last four digits as the card, but a BANK account is not the CREDIT one, so it is not inherited.
    expect(byId.get("acc-same-digits-other-type")).toMatchObject({ numberLast4: "4444", capitalAccountId: null });
    // The three new accounts and the old "Outra" are unmapped; the card is mapped and the brokerage is set.
    expect(report.items[0]?.stats?.unmapped).toBe(4);
  });
});

describe("which brokerage receives the investments", () => {
  const cdb = investments.filter((row) => row.id === "inv-cdb");

  it("falls back to an account link mapped to a brokerage when the chosen brokerage is archived or of the other entity", async () => {
    const pjBroker = await prisma.account.create({ data: { userId: USER, entityId: f.pjId, type: "brokerage", name: "Inter", currency: "BRL" } });
    const item = await newItem({ brokerageAccountId: pjBroker.id });
    await prisma.pluggyAccountLink.create({ data: { itemRowId: item.id, pluggyAccountId: "acc-inv", name: "Corretora", type: "INVESTMENT", capitalAccountId: f.broker } });

    const report = await syncPluggy(USER, deps(fake({ investments: cdb }).client), { trigger: "cron" });

    expect(report.items[0]?.stats?.unmapped).toBe(0);
    const holding = await prisma.investmentHolding.findFirstOrThrow({ where: { account: { userId: USER } } });
    expect(holding.accountId).toBe(f.broker);

    await prisma.investmentHolding.deleteMany({ where: { account: { userId: USER } } });
    await prisma.pluggyInvestmentLink.deleteMany({ where: { userId: USER } });
    await prisma.account.update({ where: { id: f.broker }, data: { archivedAt: new Date() } });
    await prisma.pluggyItem.update({ where: { id: item.id }, data: { brokerageAccountId: f.broker } });
    const archived = await syncPluggy(USER, deps(fake({ investments: cdb }).client), { trigger: "cron" });
    expect(archived.items[0]?.stats?.unmapped).toBe(1);
    expect(await prisma.investmentHolding.count({ where: { account: { userId: USER } } })).toBe(0);
  });

  it("leaves the investments alone and counts the connection as unmapped when there is no brokerage at all", async () => {
    await newItem({ brokerageAccountId: null });
    const { client, calls } = fake({ investments: cdb, investmentTransactions: investmentTxs.filter((row) => row.investmentId === "inv-cdb") });

    const report = await syncPluggy(USER, deps(client), { trigger: "cron" });

    expect(report.items[0]).toMatchObject({ status: "ok", stats: { unmapped: 1, created: 0 } });
    expect(calls.investments).toBe(0);
    expect(await prisma.investmentHolding.count({ where: { account: { userId: USER } } })).toBe(0);
  });

  it("books an amortization's cash on the mapped checking account when there is one", async () => {
    const item = await newItem({ brokerageAccountId: f.broker });
    await mapChecking(item.id, f.pfChecking);

    await syncPluggy(
      USER,
      deps(fake({ accounts: [checking], investments: cdb, investmentTransactions: investmentTxs.filter((row) => ["itx-buy", "itx-amort"].includes(row.id)) }).client),
      { trigger: "cron" },
    );

    const cash = await prisma.ledgerEntry.findFirstOrThrow({ where: { userId: USER, description: { contains: "Amortização" } } });
    expect(cash.accountId).toBe(f.pfChecking);
    expect(cash.kind).toBe("investment");
    expect(Number(cash.amount)).toBeCloseTo(200);
  });

  it("reuses a holding the user already has for the ticker instead of creating another one", async () => {
    await newItem({ brokerageAccountId: f.broker });
    const existing = await createHolding(USER, { accountId: f.broker, assetClass: "stocks", ticker: "PETR4", name: "Petrobras manual", currency: "BRL" }, prisma);

    await syncPluggy(
      USER,
      deps(fake({ investments: investments.filter((row) => row.id === "inv-petr4"), investmentTransactions: investmentTxs.filter((row) => row.id === "itx-jcp") }).client),
      { trigger: "cron" },
    );

    const holdings = await prisma.investmentHolding.findMany({ where: { account: { userId: USER } } });
    expect(holdings.map((holding) => holding.id)).toEqual([existing.id]);
    const link = await prisma.pluggyInvestmentLink.findFirstOrThrow({ where: { userId: USER } });
    expect(link).toMatchObject({ pluggyInvestmentId: "inv-petr4", holdingId: existing.id });
    expect(await prisma.investmentOperation.count({ where: { holdingId: existing.id, incomeType: "jcp" } })).toBe(1);
  });
});
