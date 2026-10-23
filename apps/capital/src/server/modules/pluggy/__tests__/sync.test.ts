import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { toNumber } from "@capital/server/modules/ledger/lib/money";
import { createEntry } from "@capital/server/modules/ledger/services/entries";
import { updateOperation } from "@capital/server/modules/investments/services/portfolio";
import { proventos12m } from "@capital/server/modules/investments/services/proventos";
import { createLedgerFixture, deleteLedgerFixture } from "@/test/ledger-fixtures";
import snapshot from "./fixtures/pluggy-snapshot.json";
import { onOrAfter } from "../lib/consent";
import type { IncomeGuesser } from "../lib/classify";
import type { PluggyAccount, PluggyClient, PluggyInvestment, PluggyInvestmentTransaction, PluggyItemPayload, PluggyTransaction } from "../lib/types";
import { resolvePluggyReview } from "../services/items";
import { syncPluggy } from "../services/sync";

const NOW = new Date("2026-10-19T15:00:00.000Z");
const users: string[] = [];

type FixtureInvestmentTx = PluggyInvestmentTransaction & { investmentId: string };

afterAll(async () => {
  for (const id of users) await deleteLedgerFixture(prisma, id);
});

function fake(opts: {
  item?: Partial<PluggyItemPayload>;
  accounts?: PluggyAccount[];
  transactions?: PluggyTransaction[];
  investments?: PluggyInvestment[];
  investmentTransactions?: FixtureInvestmentTx[];
}) {
  const calls = { accounts: 0, investments: 0, since: [] as string[] };
  const client: PluggyClient = {
    async getItem() {
      return { ...(snapshot.item as PluggyItemPayload), ...opts.item };
    },
    async getAccounts() {
      calls.accounts += 1;
      return opts.accounts ?? [];
    },
    async getTransactions(accountId, since) {
      calls.since.push(since);
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

async function connect(userId: string, opts: { entityKind?: "personal" | "business"; brokerageId?: string | null; incomeCategoryId?: string | null } = {}) {
  users.push(userId);
  const fixture = await createLedgerFixture(prisma, userId);
  const item = await prisma.pluggyItem.create({
    data: {
      userId,
      label: opts.entityKind === "business" ? "Nubank PJ" : "Nubank",
      itemId: "11111111-1111-4111-8111-111111111111",
      entityKind: opts.entityKind ?? "personal",
      brokerageAccountId: opts.brokerageId === undefined ? fixture.broker : opts.brokerageId,
      incomeCategoryId: opts.incomeCategoryId ?? null,
    },
  });
  return { fixture, item };
}

async function mapChecking(itemId: string, accountId: string) {
  await prisma.pluggyAccountLink.create({
    data: { itemRowId: itemId, pluggyAccountId: checking.id, name: "pending", type: "BANK", capitalAccountId: accountId },
  });
}

function run(userId: string, client: PluggyClient, guesser: IncomeGuesser | null = null, enabled = true) {
  return syncPluggy(userId, { db: prisma, client, now: NOW, guesser, enabled }, { trigger: "manual" });
}

const checking = snapshot.accounts[0] as PluggyAccount;
const debit = snapshot.transactions[0] as PluggyTransaction;
const credit = snapshot.transactions[1] as PluggyTransaction;
const oldDebit = snapshot.transactions[2] as PluggyTransaction;
const investments = snapshot.investments as PluggyInvestment[];
const investmentTxs = snapshot.investmentTransactions as FixtureInvestmentTx[];
const txById = (...ids: string[]) => investmentTxs.filter((row) => ids.includes(row.id));
const assetById = (...ids: string[]) => investments.filter((row) => ids.includes(row.id));

describe("syncPluggy", () => {
  it("imports a bank debit once and stores a masked account label", async () => {
    const userId = "pluggy-idem";
    const fixture = await createLedgerFixture(prisma, userId);
    users.push(userId);
    const { item } = await prisma.pluggyItem
      .create({
        data: { userId, label: "Nubank", itemId: "11111111-1111-4111-8111-111111111111", entityKind: "personal" },
      })
      .then(async (item) => {
        await prisma.pluggyAccountLink.create({
          data: { itemRowId: item.id, pluggyAccountId: checking.id, name: "pending", type: "BANK", capitalAccountId: fixture.pfChecking },
        });
        return { item };
      });
    const recent = { ...debit, id: "tx-debit-recent", date: "2026-10-16T12:00:00.000Z" };
    const { client } = fake({ accounts: [checking], transactions: [recent] });
    const first = await run(userId, client);
    const second = await run(userId, client);
    expect(first.status).toBe("ok");
    expect(second.items[0]?.stats?.skipped).toBe(1);
    expect(second.items[0]?.stats?.created).toBe(0);
    const rows = await prisma.ledgerEntry.findMany({ where: { userId, deletedAt: null, description: "PIX mercado" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.metadata).toMatchObject({ source: "pluggy" });
    expect(await prisma.pluggyExternalRef.count({ where: { userId, pluggyId: recent.id } })).toBe(1);
    const link = await prisma.pluggyAccountLink.findFirstOrThrow({ where: { itemRowId: item.id, pluggyAccountId: checking.id } });
    expect(link.name).toBe("Conta ••••7890");
    expect(link.name).not.toContain("1234567890");
  });

  it("re-reads the seven-day overlap and does not import a transaction from before it twice", async () => {
    const userId = "pluggy-overlap";
    const { fixture, item } = await connect(userId, { brokerageId: null });
    await mapChecking(item.id, fixture.pfChecking);
    const { client, calls } = fake({ accounts: [checking], transactions: [oldDebit, credit] });
    await run(userId, client);
    await run(userId, client);
    expect(calls.since).toEqual(["2025-10-19", "2026-10-12"]);
    const rows = await prisma.ledgerEntry.findMany({ where: { userId, deletedAt: null } });
    expect(rows.map((row) => row.description).sort()).toEqual(["Débito antigo", "TED recebida"]);
  });

  it("links one fuzzy candidate and leaves the manual entry unchanged", async () => {
    const userId = "pluggy-fuzzy";
    const fixture = await createLedgerFixture(prisma, userId);
    users.push(userId);
    const item = await prisma.pluggyItem.create({
      data: { userId, label: "Nubank", itemId: "22222222-2222-4222-8222-222222222222", entityKind: "personal" },
    });
    await prisma.pluggyAccountLink.create({
      data: { itemRowId: item.id, pluggyAccountId: checking.id, name: "Conta", type: "BANK", capitalAccountId: fixture.pfChecking },
    });
    const manual = await createEntry(userId, { kind: "expense", accountId: fixture.pfChecking, amount: 42.5, date: "2026-10-10", description: "Lançamento manual" }, prisma);
    await run(userId, fake({ accounts: [checking], transactions: [debit] }).client);
    const rows = await prisma.ledgerEntry.findMany({ where: { userId, deletedAt: null } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(manual.entryIds[0]);
    expect(rows[0]?.description).toBe("Lançamento manual");
    expect(toNumber(rows[0]!.amount)).toBeCloseTo(-42.5);
    const ref = await prisma.pluggyExternalRef.findUniqueOrThrow({ where: { userId_pluggyId: { userId, pluggyId: debit.id } } });
    expect(ref.matchKind).toBe("linked");
    expect(ref.ledgerEntryId).toBe(manual.entryIds[0]);
  });

  it("opens a conflict review when two entries match and writes nothing", async () => {
    const userId = "pluggy-conflict";
    const { fixture, item } = await connect(userId, { brokerageId: null });
    await mapChecking(item.id, fixture.pfChecking);
    await createEntry(userId, { kind: "expense", accountId: fixture.pfChecking, amount: 42.5, date: "2026-10-10", description: "Manual A" }, prisma);
    await createEntry(userId, { kind: "expense", accountId: fixture.pfChecking, amount: 42.5, date: "2026-10-11", description: "Manual B" }, prisma);
    const report = await run(userId, fake({ accounts: [checking], transactions: [debit] }).client);
    expect(report.items[0]?.stats?.conflicts).toBe(1);
    expect(report.items[0]?.stats?.created).toBe(0);
    const rows = await prisma.ledgerEntry.findMany({ where: { userId, deletedAt: null }, orderBy: { description: "asc" } });
    expect(rows.map((row) => row.description)).toEqual(["Manual A", "Manual B"]);
    expect(await prisma.pluggyExternalRef.count({ where: { userId } })).toBe(0);
    const review = await prisma.pluggyReview.findFirstOrThrow({ where: { userId, status: "open" } });
    expect(review.kind).toBe("conflict");
    expect(review.draft).toMatchObject({ reason: "multiple_matches", pluggyId: debit.id });
  });

  it("does not read accounts when consent is expired", async () => {
    const userId = "pluggy-expired";
    await connect(userId, { brokerageId: null });
    const { client, calls } = fake({
      item: { status: "LOGIN_ERROR", error: { code: "USER_AUTHORIZATION_EXPIRED" }, consentExpiresAt: "2025-01-01T00:00:00.000Z" },
      accounts: [checking],
      transactions: [debit],
      investments: assetById("inv-petr4"),
    });
    const report = await run(userId, client);
    expect(report.items[0]?.status).toBe("expired");
    expect(calls.accounts).toBe(0);
    expect(calls.investments).toBe(0);
    expect(await prisma.ledgerEntry.count({ where: { userId } })).toBe(0);
    const item = await prisma.pluggyItem.findFirstOrThrow({ where: { userId } });
    expect(item.lastSuccessAt).toBeNull();
  });

  it("still syncs while consent is inside the warning window", async () => {
    const userId = "pluggy-expiring";
    const { fixture, item } = await connect(userId, { brokerageId: null });
    await mapChecking(item.id, fixture.pfChecking);
    const { client, calls } = fake({
      item: { status: "UPDATED", consentExpiresAt: "2026-11-01T00:00:00.000Z", error: null },
      accounts: [checking],
      transactions: [debit],
    });
    const report = await run(userId, client);
    expect(report.items[0]?.status).toBe("expiring");
    expect(calls.accounts).toBe(1);
    expect(await prisma.ledgerEntry.count({ where: { userId, description: "PIX mercado" } })).toBe(1);
    const stored = await prisma.pluggyItem.findFirstOrThrow({ where: { userId } });
    expect(stored.lastSuccessAt).not.toBeNull();
  });

  it("books JCP, FII and BDR from the rules, and skips tax and transfers", async () => {
    const userId = "pluggy-rules";
    const { fixture, item } = await connect(userId);
    await mapChecking(item.id, fixture.pfChecking);
    const guesser: IncomeGuesser = async () => {
      throw new Error("rules should have decided");
    };
    await run(
      userId,
      fake({
        accounts: [checking],
        investments: assetById("inv-petr4", "inv-hglg11", "inv-aapl34"),
        investmentTransactions: txById("itx-jcp", "itx-fii", "itx-bdr", "itx-tax", "itx-transfer"),
      }).client,
      guesser,
    );
    const ops = await prisma.investmentOperation.findMany({ where: { holding: { account: { userId } } } });
    const jcp = ops.find((op) => op.incomeType === "jcp");
    expect(jcp).toMatchObject({ taxWithheld: 15, classificationSource: "rule", totalAmount: 100 });
    const cash = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: jcp!.cashEntryId! } });
    expect(cash.kind).toBe("investment");
    expect(cash.accountId).toBe(fixture.broker);
    expect(toNumber(cash.amount)).toBeCloseTo(85);
    const fii = ops.find((op) => op.incomeType === "fii_income");
    const fiiCash = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: fii!.cashEntryId! } });
    expect(fiiCash.accountId).toBe(fixture.broker);
    expect(ops.find((op) => op.incomeType === "fii_income")).toMatchObject({ taxWithheld: 0, totalAmount: 20 });
    expect(ops.find((op) => op.dividendOrigin === "BDR")).toMatchObject({ incomeType: "dividend", totalAmount: 12 });
    expect(ops.some((op) => op.externalId === "itx-tax" || op.externalId === "itx-transfer")).toBe(false);
    const personal = await proventos12m(userId, prisma, [fixture.pfId]);
    expect(personal.total).toBeCloseTo(117);
  });

  it("reduces cost basis on amortization and keeps the cash out of Renda Passiva", async () => {
    const userId = "pluggy-amort";
    const { fixture } = await connect(userId);
    await run(
      userId,
      fake({
        investments: assetById("inv-cdb"),
        investmentTransactions: txById("itx-buy", "itx-amort"),
      }).client,
    );
    const holding = await prisma.investmentHolding.findFirstOrThrow({ where: { account: { userId } } });
    expect(holding.totalInvested).toBeCloseTo(800);
    const cash = await prisma.ledgerEntry.findFirstOrThrow({ where: { userId, description: { contains: "Amortização" } } });
    expect(cash.kind).toBe("investment");
    expect(toNumber(cash.amount)).toBeCloseTo(200);
    expect((await proventos12m(userId, prisma, [fixture.pfId])).total).toBe(0);
  });

  it("keeps a low-confidence guess unbooked until the review confirms it", async () => {
    const userId = "pluggy-llm";
    const { fixture, item } = await connect(userId);
    await mapChecking(item.id, fixture.pfChecking);
    const guesser: IncomeGuesser = async () => ({ incomeType: "dividend", origin: "EXTERIOR", confidence: 0.4 });
    const report = await run(userId, fake({ investments: assetById("inv-other"), investmentTransactions: txById("itx-guess") }).client, guesser);
    expect(report.items[0]?.status).toBe("ok");
    expect(await prisma.investmentOperation.count({ where: { holding: { account: { userId } } } })).toBe(0);
    expect(await prisma.pluggyExternalRef.count({ where: { userId, pluggyId: "itx-guess" } })).toBe(0);
    const review = await prisma.pluggyReview.findFirstOrThrow({ where: { userId, kind: "low_confidence", status: "open" } });
    expect(review.draft).toMatchObject({ event: "income", incomeType: "dividend", origin: "EXTERIOR", confidence: 0.4, cashAccountId: fixture.broker });
    await resolvePluggyReview(userId, review.id, "confirm", null, prisma, { incomeType: "jcp", origin: null });
    const op = await prisma.investmentOperation.findFirstOrThrow({ where: { holding: { account: { userId } } } });
    expect(op).toMatchObject({ incomeType: "jcp", dividendOrigin: null, classificationSource: "manual", syncLocked: true });
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: op.cashEntryId! } })).accountId).toBe(fixture.broker);
    expect(await prisma.pluggyExternalRef.count({ where: { userId, pluggyId: "itx-guess" } })).toBe(1);
    const stored = await prisma.pluggyItem.findFirstOrThrow({ where: { userId } });
    expect(stored.lastSuccessAt).not.toBeNull();
  });

  it("books PJ caixinha interest on the business book, outside personal Renda Passiva", async () => {
    const userId = "pluggy-pj";
    const { fixture, item } = await connect(userId, { entityKind: "business", brokerageId: null });
    const pjBroker = await prisma.account.create({ data: { userId, entityId: fixture.pjId, type: "brokerage", name: "Inter", currency: "BRL" } });
    const category = await prisma.category.create({ data: { userId, name: "Renda financeira PJ", type: "income" } });
    await prisma.pluggyItem.update({ where: { id: item.id }, data: { brokerageAccountId: pjBroker.id, incomeCategoryId: category.id } });
    await prisma.pluggyAccountLink.create({
      data: { itemRowId: item.id, pluggyAccountId: checking.id, name: "Conta PJ", type: "BANK", capitalAccountId: fixture.pjChecking },
    });
    await run(userId, fake({ accounts: [checking], investments: assetById("inv-cdb"), investmentTransactions: txById("itx-pj") }).client);
    const op = await prisma.investmentOperation.findFirstOrThrow({ where: { holding: { accountId: pjBroker.id } }, include: { holding: { include: { account: true } } } });
    expect(op.incomeType).toBe("fixed_income_interest");
    expect(op.holding.account.entityId).toBe(fixture.pjId);
    const cash = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: op.cashEntryId! } });
    expect(cash.accountId).toBe(pjBroker.id);
    expect(cash.categoryId).toBe(category.id);
    expect(cash.kind).toBe("investment");
    expect((await proventos12m(userId, prisma, [fixture.pfId])).rows).toEqual([]);
    expect((await proventos12m(userId, prisma, [fixture.pjId])).rows).toEqual([]);
  });

  it("writes nothing when the integration is disabled", async () => {
    const userId = "pluggy-off";
    const { item } = await connect(userId, { brokerageId: null });
    const { client, calls } = fake({ accounts: [checking], transactions: [debit] });
    const report = await run(userId, client, null, false);
    expect(report).toEqual({ status: "disabled", items: [] });
    expect(calls.accounts).toBe(0);
    const stored = await prisma.pluggyItem.findFirstOrThrow({ where: { userId } });
    expect(stored.lastSyncAt).toBeNull();
    expect(stored.status).toBe("idle");
    expect(await prisma.pluggySyncRun.count({ where: { itemRowId: item.id } })).toBe(0);
  });

  it("keeps a manual amount edit on the next run", async () => {
    const userId = "pluggy-manual";
    const { fixture, item } = await connect(userId, { brokerageId: null });
    await mapChecking(item.id, fixture.pfChecking);
    const { client } = fake({ accounts: [checking], transactions: [debit] });
    await run(userId, client);
    const created = await prisma.ledgerEntry.findFirstOrThrow({ where: { userId, description: "PIX mercado" } });
    await prisma.ledgerEntry.update({ where: { id: created.id }, data: { amount: -1 } });
    await run(userId, client);
    const again = await prisma.ledgerEntry.findMany({ where: { userId, deletedAt: null } });
    expect(again).toHaveLength(1);
    expect(toNumber(again[0]!.amount)).toBeCloseTo(-1);
  });

  it("links a repeated dividend to the existing operation and keeps a manual edit", async () => {
    const userId = "pluggy-op-fuzzy";
    const { fixture, item } = await connect(userId);
    await mapChecking(item.id, fixture.pfChecking);
    await run(userId, fake({ investments: assetById("inv-petr4"), investmentTransactions: txById("itx-jcp") }).client);
    const op = await prisma.investmentOperation.findFirstOrThrow({ where: { holding: { account: { userId } } } });
    await updateOperation(userId, op.id, { notes: "edited" }, prisma);
    const renewed = { ...txById("itx-jcp")[0]!, id: "itx-jcp-new", date: "2026-10-13T00:00:00.000Z", tradeDate: "2026-10-13T00:00:00.000Z" };
    await run(userId, fake({ investments: assetById("inv-petr4"), investmentTransactions: [renewed] }).client);
    const ops = await prisma.investmentOperation.findMany({ where: { holding: { account: { userId } } } });
    expect(ops).toHaveLength(1);
    expect(ops[0]?.notes).toBe("edited");
    expect(ops[0]?.syncLocked).toBe(true);
    expect(toNumber(ops[0]!.totalAmount)).toBeCloseTo(100);
    const ref = await prisma.pluggyExternalRef.findUniqueOrThrow({ where: { userId_pluggyId: { userId, pluggyId: "itx-jcp-new" } } });
    expect(ref.matchKind).toBe("linked");
    expect(ref.operationId).toBe(op.id);
  });

  it("does not import transactions from before the connection cutoff", async () => {
    const userId = "pluggy-cutoff";
    const { fixture, item } = await connect(userId, { brokerageId: null });
    await prisma.pluggyItem.update({ where: { id: item.id }, data: { syncCutoff: new Date("2026-10-12T12:00:00.000Z") } });
    await mapChecking(item.id, fixture.pfChecking);
    const { client, calls } = fake({ accounts: [checking], transactions: [debit, credit] });
    const report = await run(userId, client);
    expect(calls.since[0]).toBe("2026-10-12");
    expect(report.items[0]?.stats?.created).toBe(1);
    const rows = await prisma.ledgerEntry.findMany({ where: { userId, deletedAt: null } });
    expect(rows.map((row) => row.description)).toEqual(["TED recebida"]);
    expect(await prisma.pluggyExternalRef.count({ where: { userId, pluggyId: debit.id } })).toBe(0);
  });

  it("books money moving between mapped accounts as one transfer", async () => {
    const userId = "pluggy-transfer";
    const { fixture, item } = await connect(userId, { brokerageId: null });
    const savings = await prisma.account.create({ data: { userId, entityId: fixture.pfId, type: "cash", name: "Reserva", currency: "BRL" } });
    await mapChecking(item.id, fixture.pfChecking);
    await prisma.pluggyAccountLink.create({ data: { itemRowId: item.id, pluggyAccountId: "acc-savings", name: "Reserva", type: "BANK", capitalAccountId: savings.id } });
    const savingsAccount = { ...checking, id: "acc-savings", number: "009988776655", marketingName: "Reserva" };
    const out = { id: "tx-out", description: "PIX enviado", amount: 80, date: "2026-10-16T12:00:00.000Z", type: "DEBIT" as const, status: "POSTED", accountId: checking.id, currencyCode: "BRL" };
    const inn = { id: "tx-in", description: "PIX recebido", amount: 80, date: "2026-10-17T12:00:00.000Z", type: "CREDIT" as const, status: "POSTED", accountId: "acc-savings", currencyCode: "BRL" };
    await run(userId, fake({ accounts: [checking, savingsAccount], transactions: [out, inn] }).client);
    const entries = await prisma.ledgerEntry.findMany({ where: { userId, deletedAt: null } });
    expect(entries).toHaveLength(2);
    expect(entries.every((row) => row.kind === "transfer")).toBe(true);
    expect((await prisma.transferGroup.findFirstOrThrow({ where: { userId } })).direction).toBe("between_accounts");
    expect(await prisma.pluggyExternalRef.count({ where: { userId } })).toBe(2);
  });

  it("leaves an ambiguous pair of transfers in review and books neither", async () => {
    const userId = "pluggy-ambiguous";
    const { fixture, item } = await connect(userId, { brokerageId: null });
    const savings = await prisma.account.create({ data: { userId, entityId: fixture.pfId, type: "cash", name: "Reserva", currency: "BRL" } });
    await mapChecking(item.id, fixture.pfChecking);
    await prisma.pluggyAccountLink.create({ data: { itemRowId: item.id, pluggyAccountId: "acc-savings", name: "Reserva", type: "BANK", capitalAccountId: savings.id } });
    const savingsAccount = { ...checking, id: "acc-savings", number: "009988776655", marketingName: "Reserva" };
    const out = { id: "tx-out-amb", description: "PIX enviado", amount: 80, date: "2026-10-16T12:00:00.000Z", type: "DEBIT" as const, status: "POSTED", accountId: checking.id, currencyCode: "BRL" };
    const first = { id: "tx-in-a", description: "PIX recebido", amount: 80, date: "2026-10-16T12:00:00.000Z", type: "CREDIT" as const, status: "POSTED", accountId: "acc-savings", currencyCode: "BRL" };
    const second = { id: "tx-in-b", description: "PIX recebido", amount: 80, date: "2026-10-17T12:00:00.000Z", type: "CREDIT" as const, status: "POSTED", accountId: "acc-savings", currencyCode: "BRL" };
    await run(userId, fake({ accounts: [checking, savingsAccount], transactions: [out, first, second] }).client);
    expect(await prisma.ledgerEntry.count({ where: { userId, deletedAt: null } })).toBe(0);
    expect(await prisma.pluggyExternalRef.count({ where: { userId } })).toBe(0);
    const review = await prisma.pluggyReview.findFirstOrThrow({ where: { userId, status: "open" } });
    expect(review.draft).toMatchObject({ reason: "ambiguous" });
  });

  it("books a card bill payment as a transfer, skips pending, and does not book a card credit as income", async () => {
    const userId = "pluggy-card";
    const { fixture, item } = await connect(userId, { brokerageId: null });
    await mapChecking(item.id, fixture.pfChecking);
    const card = snapshot.accounts[1] as PluggyAccount;
    await prisma.pluggyAccountLink.create({ data: { itemRowId: item.id, pluggyAccountId: card.id, name: "Cartão", type: "CREDIT", capitalAccountId: fixture.card } });
    const billOut = { id: "tx-bill", description: "Pagamento fatura", amount: 320, date: "2026-10-16T12:00:00.000Z", type: "DEBIT" as const, status: "POSTED", accountId: checking.id, currencyCode: "BRL" };
    const billIn = { id: "tx-bill-card", description: "Pagamento recebido", amount: 320, date: "2026-10-16T12:00:00.000Z", type: "CREDIT" as const, status: "POSTED", accountId: card.id, currencyCode: "BRL" };
    const refund = { id: "tx-refund", description: "Estorno", amount: 15, date: "2026-10-16T12:00:00.000Z", type: "CREDIT" as const, status: "POSTED", accountId: card.id, currencyCode: "BRL" };
    const pending = { id: "tx-pending", description: "Compra pendente", amount: 9, date: "2026-10-16T12:00:00.000Z", type: "DEBIT" as const, status: "PENDING", accountId: card.id, currencyCode: "BRL" };
    await run(userId, fake({ accounts: [checking, card], transactions: [billOut, billIn, refund, pending] }).client);
    const entries = await prisma.ledgerEntry.findMany({ where: { userId, deletedAt: null } });
    expect(entries).toHaveLength(2);
    expect(entries.every((row) => row.kind === "transfer")).toBe(true);
    expect((await prisma.transferGroup.findFirstOrThrow({ where: { userId } })).direction).toBe("card_payment");
    expect(await prisma.ledgerEntry.count({ where: { userId, kind: "income" } })).toBe(0);
    const review = await prisma.pluggyReview.findFirstOrThrow({ where: { userId, status: "open" } });
    expect(review.draft).toMatchObject({ pluggyId: refund.id, reason: "card_credit" });
    expect(await prisma.pluggyExternalRef.count({ where: { userId, pluggyId: pending.id } })).toBe(0);
  });

  it("books a caixinha deposit as a transfer into the brokerage", async () => {
    const userId = "pluggy-caixa";
    const { fixture, item } = await connect(userId);
    await mapChecking(item.id, fixture.pfChecking);
    const apply = { id: "tx-caixa", description: "Aplicação caixinha", amount: 50, date: "2026-10-16T12:00:00.000Z", type: "DEBIT" as const, status: "POSTED", accountId: checking.id, currencyCode: "BRL" };
    await run(userId, fake({ accounts: [checking], transactions: [apply] }).client);
    const entries = await prisma.ledgerEntry.findMany({ where: { userId, deletedAt: null } });
    expect(entries).toHaveLength(2);
    expect(entries.every((row) => row.kind === "transfer")).toBe(true);
    expect(entries.some((row) => row.accountId === fixture.broker)).toBe(true);
    expect((await prisma.transferGroup.findFirstOrThrow({ where: { userId } })).direction).toBe("investment_deposit");
  });

  it("finishes the sync when the model fails, booking rule income on the brokerage", async () => {
    const userId = "pluggy-partial";
    const { fixture, item } = await connect(userId);
    const guesser: IncomeGuesser = async () => {
      throw new Error("haiku down");
    };
    const report = await run(
      userId,
      fake({
        investments: assetById("inv-petr4", "inv-cdb", "inv-other"),
        investmentTransactions: txById("itx-jcp", "itx-buy", "itx-guess"),
      }).client,
      guesser,
    );
    expect(report.items[0]?.status).toBe("ok");
    const stored = await prisma.pluggyItem.findFirstOrThrow({ where: { id: item.id } });
    expect(stored.lastSuccessAt).not.toBeNull();
    const ops = await prisma.investmentOperation.findMany({ where: { holding: { account: { userId } } } });
    expect(ops.map((op) => op.type).sort()).toEqual(["buy", "dividend"]);
    const jcp = ops.find((op) => op.incomeType === "jcp");
    expect(jcp?.cashEntryId).toBeTruthy();
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: jcp!.cashEntryId! } })).accountId).toBe(fixture.broker);
    expect(await prisma.pluggyExternalRef.count({ where: { userId, pluggyId: "itx-jcp" } })).toBe(1);
    expect(await prisma.pluggyExternalRef.count({ where: { userId, pluggyId: "itx-guess" } })).toBe(0);
    const draft = await prisma.pluggyReview.findFirstOrThrow({ where: { userId, kind: "low_confidence" } });
    expect(draft.draft).toMatchObject({ event: "income", pluggyId: "itx-guess", incomeType: "fixed_income_interest", confidence: 0, cashAccountId: fixture.broker });
  });

  it("refuses to confirm a sale as income", async () => {
    const userId = "pluggy-sale";
    const { item } = await connect(userId);
    const review = await prisma.pluggyReview.create({
      data: { userId, itemRowId: item.id, kind: "low_confidence", draft: { event: "sell", pluggyId: "itx-sell", gross: 40 } },
    });
    await expect(resolvePluggyReview(userId, review.id, "confirm", null, prisma, { incomeType: "dividend" })).rejects.toThrow(/not income/);
    expect(await prisma.investmentOperation.count({ where: { holding: { account: { userId } } } })).toBe(0);
  });

  it("matches a renewed item by the last four digits and links an entry that already has a ref", async () => {
    const userId = "pluggy-renew";
    const { fixture, item } = await connect(userId, { brokerageId: null });
    await prisma.pluggyAccountLink.create({
      data: { itemRowId: item.id, pluggyAccountId: "acc-old", name: "Conta ••••7890", type: "BANK", numberLast4: "7890", capitalAccountId: fixture.pfChecking },
    });
    const manual = await createEntry(userId, { kind: "expense", accountId: fixture.pfChecking, amount: 42.5, date: "2026-10-10", description: "Já lançado" }, prisma);
    await prisma.pluggyExternalRef.create({ data: { userId, pluggyId: "tx-old-pluggy", ledgerEntryId: manual.entryIds[0], matchKind: "created" } });
    const renewed = { ...checking, id: "acc-new" };
    const renewedDebit = { ...debit, accountId: "acc-new" };
    await run(userId, fake({ accounts: [renewed], transactions: [renewedDebit] }).client);
    const link = await prisma.pluggyAccountLink.findFirstOrThrow({ where: { itemRowId: item.id, pluggyAccountId: "acc-new" } });
    expect(link.capitalAccountId).toBe(fixture.pfChecking);
    expect(link.numberLast4).toBe("7890");
    const rows = await prisma.ledgerEntry.findMany({ where: { userId, deletedAt: null } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.description).toBe("Já lançado");
    const ref = await prisma.pluggyExternalRef.findUniqueOrThrow({ where: { userId_pluggyId: { userId, pluggyId: debit.id } } });
    expect(ref.matchKind).toBe("linked");
    expect(ref.ledgerEntryId).toBe(manual.entryIds[0]);
  });

  it("records a skipped run when the item is already syncing", async () => {
    const userId = "pluggy-busy";
    const { item } = await connect(userId, { brokerageId: null });
    await prisma.pluggyItem.update({ where: { id: item.id }, data: { syncingAt: NOW } });
    const report = await run(userId, fake({ accounts: [checking], transactions: [debit] }).client);
    expect(report.items[0]?.status).toBe("busy");
    const runs = await prisma.pluggySyncRun.findMany({ where: { itemRowId: item.id } });
    expect(runs.map((run) => run.status)).toEqual(["skipped"]);
    expect(await prisma.ledgerEntry.count({ where: { userId } })).toBe(0);
  });
});
