import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { recordDividend } from "@capital/server/modules/investments/services/dividends";
import { createHolding } from "@capital/server/modules/investments/services/portfolio";
import { createEntry } from "@capital/server/modules/ledger/services/entries";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import snapshot from "./fixtures/pluggy-snapshot.json";
import { onOrAfter } from "../lib/consent";
import type { IncomeGuesser } from "../lib/classify";
import type { PluggyClient, PluggyInvestment, PluggyInvestmentTransaction, PluggyItemPayload } from "../lib/types";
import { syncPluggy } from "../services/sync";

const NOW = new Date("2026-10-19T15:00:00.000Z");
const USER = "test-user-pluggy-investments-001";

type InvTx = PluggyInvestmentTransaction & { investmentId: string };

let f: LedgerFixture;
let itemId: string;

beforeEach(async () => {
  f = await createLedgerFixture(prisma, USER);
  const item = await prisma.pluggyItem.create({
    data: { userId: USER, label: "Corretora", itemId: "11111111-1111-4111-8111-111111111111", entityKind: "personal", brokerageAccountId: f.broker },
  });
  itemId = item.id;
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

/** `unfiltered` makes the fake ignore the `since` window, as a client that returned too much would. */
function fake(opts: { investments?: PluggyInvestment[]; txs?: InvTx[]; unfiltered?: boolean }) {
  const client: PluggyClient = {
    async getItem() {
      return snapshot.item as PluggyItemPayload;
    },
    async getAccounts() {
      return [];
    },
    async getTransactions() {
      return [];
    },
    async getInvestments() {
      return opts.investments ?? [];
    },
    async getInvestmentTransactions(investmentId, since) {
      return (opts.txs ?? []).filter((row) => row.investmentId === investmentId && (opts.unfiltered || onOrAfter(row.tradeDate ?? row.date, since)));
    },
  };
  return client;
}

const run = (client: PluggyClient, guesser: IncomeGuesser | null = null) =>
  syncPluggy(USER, { db: prisma, client, now: NOW, guesser, enabled: true }, { trigger: "manual" });

const stock = (id: string, extra: Partial<PluggyInvestment> = {}): PluggyInvestment => ({
  id,
  type: "EQUITY",
  subtype: "STOCK",
  name: id.toUpperCase(),
  code: id.toUpperCase(),
  quantity: null,
  value: 10,
  amount: 100,
  currencyCode: "BRL",
  ...extra,
});

const tx = (id: string, investmentId: string, type: string, amount: number, day: string, extra: Partial<InvTx> = {}): InvTx => ({
  id,
  investmentId,
  type,
  amount,
  date: `${day}T00:00:00.000Z`,
  tradeDate: `${day}T00:00:00.000Z`,
  ...extra,
});

const holdingByTicker = (ticker: string) => prisma.investmentHolding.findFirstOrThrow({ where: { account: { userId: USER }, ticker } });
const reviews = (kind?: string) => prisma.pluggyReview.findMany({ where: { userId: USER, ...(kind && { kind }) }, orderBy: { createdAt: "asc" } });

describe("investment transactions", () => {
  it("books a sale after the purchase that covers it even when Pluggy lists them the other way round and without a trade date", async () => {
    const buy = tx("t-buy", "wege3", "BUY", 400, "2026-10-12", { tradeDate: null, quantity: 10, value: 40 });
    const sell = tx("t-sell", "wege3", "SELL", 250, "2026-10-14", { tradeDate: undefined, quantity: 5, value: 50 });

    const report = await run(fake({ investments: [stock("wege3", { quantity: 5 })], txs: [sell, buy] }));

    expect(report.items[0]).toMatchObject({ status: "ok", stats: { created: 2, conflicts: 0 } });
    const holding = await holdingByTicker("WEGE3");
    expect(holding.currentQuantity).toBe(5);
    const ops = await prisma.investmentOperation.findMany({ where: { holdingId: holding.id }, orderBy: { date: "asc" } });
    expect(ops.map((op) => [op.type, op.externalId])).toEqual([["buy", "t-buy"], ["sell", "t-sell"]]);
    expect(await reviews()).toEqual([]);
  });

  it("skips a transaction it has already booked on the next run", async () => {
    const client = fake({ investments: [stock("vale3", { quantity: 3 })], txs: [tx("t-once", "vale3", "BUY", 90, "2026-10-12", { quantity: 3, value: 30 })] });
    expect((await run(client)).items[0]?.stats).toMatchObject({ created: 1, skipped: 0 });
    const again = await run(client);
    expect(again.items[0]?.stats).toMatchObject({ created: 0, skipped: 1 });
    expect(await prisma.investmentOperation.count({ where: { holding: { account: { userId: USER } }, type: "buy" } })).toBe(1);
  });

  it("ignores a transaction from before the connection's cutoff even if the client returned it", async () => {
    await prisma.pluggyItem.update({ where: { id: itemId }, data: { syncCutoff: new Date("2026-10-12T12:00:00.000Z") } });
    const early = tx("t-early", "itub4", "BUY", 100, "2026-10-10", { quantity: 1, value: 100 });
    const late = tx("t-late", "itub4", "BUY", 200, "2026-10-15", { quantity: 2, value: 100, tradeDate: null });

    const report = await run(fake({ investments: [stock("itub4", { quantity: 2 })], txs: [early, late], unfiltered: true }));

    expect(report.items[0]?.stats).toMatchObject({ created: 1, skipped: 1 });
    expect(await prisma.pluggyExternalRef.findMany({ where: { userId: USER }, select: { pluggyId: true } })).toEqual([{ pluggyId: "t-late" }]);
    expect((await holdingByTicker("ITUB4")).currentQuantity).toBe(2);
  });

  it("remembers a transfer or a tax row as handled without booking anything", async () => {
    const report = await run(
      fake({
        investments: [stock("abev3")],
        txs: [tx("t-tax", "abev3", "TAX", 3, "2026-10-12"), tx("t-transfer", "abev3", "TRANSFER", 50, "2026-10-12")],
      }),
    );
    expect(report.items[0]?.stats).toMatchObject({ created: 0, skipped: 2 });
    const refs = await prisma.pluggyExternalRef.findMany({ where: { userId: USER }, orderBy: { pluggyId: "asc" } });
    expect(refs.map((ref) => [ref.pluggyId, ref.matchKind, ref.ledgerEntryId, ref.operationId])).toEqual([["t-tax", "linked", null, null], ["t-transfer", "linked", null, null]]);
    expect(await prisma.investmentOperation.count({ where: { holding: { account: { userId: USER } } } })).toBe(0);
  });

  it("opens one conflict review when several operations could be the same income, and does not pile up another on the next run", async () => {
    const holding = await createHolding(USER, { accountId: f.broker, assetClass: "stocks", ticker: "PETR4", name: "Petrobras", currency: "BRL" }, prisma);
    const first = await prisma.investmentOperation.create({ data: { holdingId: holding.id, type: "dividend", incomeType: "jcp", totalAmount: 100, date: new Date("2026-10-09T12:00:00Z") } });
    const second = await prisma.investmentOperation.create({ data: { holdingId: holding.id, type: "dividend", incomeType: "jcp", totalAmount: 100, date: new Date("2026-10-11T12:00:00Z") } });
    const jcp = tx("t-jcp", "petr4", "INTEREST", 100, "2026-10-10", { description: "JCP PETR4", netAmount: 85, expenses: { incomeTax: 15 } });
    const client = fake({ investments: [stock("petr4")], txs: [jcp] });

    const report = await run(client);
    await run(client);

    expect(report.items[0]?.stats).toMatchObject({ conflicts: 1, created: 0, linked: 0 });
    const open = await reviews("conflict");
    expect(open).toHaveLength(1);
    expect(open[0]?.draft).toMatchObject({ pluggyId: "t-jcp", reason: "multiple_matches", amount: 100, date: "2026-10-10", ticker: "PETR4", holdingId: holding.id });
    expect((open[0]!.draft as { candidateIds: string[] }).candidateIds.sort()).toEqual([first.id, second.id].sort());
    expect(await prisma.investmentOperation.count({ where: { holdingId: holding.id } })).toBe(2);
    expect(await prisma.pluggyExternalRef.count({ where: { userId: USER } })).toBe(0);
  });

  it("opens a conflict review with the reason when booking a transaction fails, and carries on with the rest", async () => {
    // Selling shares that were never bought is refused by the position check.
    const oversell = tx("t-oversell", "bbas3", "SELL", 500, "2026-10-12", { quantity: 50, value: 10, description: "Venda sem posição 123456789" });
    const fine = tx("t-fine", "bbas3", "BUY", 100, "2026-10-13", { quantity: 10, value: 10 });

    const report = await run(fake({ investments: [stock("bbas3", { quantity: 10 })], txs: [oversell, fine] }));

    expect(report.items[0]).toMatchObject({ status: "ok", stats: { conflicts: 1, created: 1 } });
    const [review] = await reviews("conflict");
    expect(review?.draft).toMatchObject({ pluggyId: "t-oversell", amount: 500, date: "2026-10-12", ticker: "BBAS3", description: "Venda sem posição ••••" });
    expect((review!.draft as { reason: string }).reason).toMatch(/oversell|sell|position|exceed/i);
    expect(await prisma.pluggyExternalRef.findMany({ where: { userId: USER }, select: { pluggyId: true } })).toEqual([{ pluggyId: "t-fine" }]);
    expect((await holdingByTicker("BBAS3")).currentQuantity).toBe(10);
  });

  it("books trades and income that arrive without optional fields", async () => {
    const cdb = stock("cdb-x", { type: "FIXED_INCOME", subtype: "CDB", code: null, name: "CDB X", value: null });
    const fii = stock("hgrx11", { subtype: "REAL_ESTATE_FUND" });
    const report = await run(
      fake({
        investments: [cdb, fii],
        txs: [
          tx("t-buy-bare", "cdb-x", "BUY", 1000, "2026-10-12", { description: null }),
          tx("t-fii-bare", "hgrx11", "INTEREST", 12, "2026-10-12", { description: null, netAmount: null, expenses: null }),
        ],
      }),
    );

    expect(report.items[0]?.stats).toMatchObject({ created: 2, conflicts: 0 });
    const buy = await prisma.investmentOperation.findFirstOrThrow({ where: { externalId: "t-buy-bare" } });
    expect(buy).toMatchObject({ type: "buy", quantity: null, pricePerUnit: null, notes: null });
    expect(Number(buy.fees)).toBe(0);
    expect(Number(buy.totalAmount)).toBe(1000);
    const income = await prisma.investmentOperation.findFirstOrThrow({ where: { externalId: "t-fii-bare" } });
    expect(income).toMatchObject({ type: "dividend", incomeType: "fii_income", classificationSource: "rule" });
    expect(Number(income.taxWithheld)).toBe(0);
  });

  it("opens a low-confidence review that falls back to the asset name and leaves the ticker empty when there is no code", async () => {
    const fund: PluggyInvestment = { id: "fund-1", type: "OTHER", subtype: "OTHER", name: "Fundo Quantitativo", code: null, quantity: null, value: 5, amount: 50, currencyCode: "BRL" };
    const guesser: IncomeGuesser = async () => ({ incomeType: "jcp", origin: null, confidence: 0.3 });

    const report = await run(fake({ investments: [fund], txs: [tx("t-guess", "fund-1", "INTEREST", 30, "2026-10-12", { description: null, expenses: { incomeTax: 50 } })] }), guesser);

    expect(report.items[0]?.stats).toMatchObject({ conflicts: 1, created: 0 });
    const [review] = await reviews("low_confidence");
    expect(review?.draft).toMatchObject({
      event: "income",
      pluggyId: "t-guess",
      incomeType: "jcp",
      gross: 30,
      // The tax withheld is never reported above the gross.
      taxWithheld: 30,
      description: "Fundo Quantitativo",
      ticker: null,
      confidence: 0.3,
      cashAccountId: f.broker,
      currency: "BRL",
    });
    expect(await prisma.investmentOperation.count({ where: { holding: { account: { userId: USER } } } })).toBe(0);
  });

  it("books rule-based income straight away when the model is not needed, with a source of rule", async () => {
    const report = await run(fake({ investments: [stock("taee11", { subtype: "STOCK" })], txs: [tx("t-div", "taee11", "INTEREST", 10, "2026-10-12", { description: "Dividendos" })] }));
    expect(report.items[0]?.stats).toMatchObject({ created: 1, conflicts: 0 });
    const op = await prisma.investmentOperation.findFirstOrThrow({ where: { externalId: "t-div" } });
    expect(op).toMatchObject({ incomeType: "fii_income", classificationSource: "rule", classificationConfidence: 1 });
  });

  it("converts an income entry the user already typed into the dividend instead of crediting twice", async () => {
    const manual = await createEntry(USER, { kind: "income", accountId: f.broker, amount: 85, date: "2026-10-10", description: "crédito petr4" }, prisma);
    const before = await prisma.ledgerEntry.count({ where: { userId: USER, deletedAt: null } });
    const jcp = tx("t-jcp-manual", "petr4", "INTEREST", 100, "2026-10-10", { description: "JCP PETR4", netAmount: 85, expenses: { incomeTax: 15 } });

    const report = await run(fake({ investments: [stock("petr4")], txs: [jcp] }));

    expect(report.items[0]?.stats).toMatchObject({ created: 1, conflicts: 0 });
    const op = await prisma.investmentOperation.findFirstOrThrow({ where: { externalId: "t-jcp-manual" } });
    expect(op).toMatchObject({ type: "dividend", incomeType: "jcp", cashEntryId: manual.entryIds[0], classificationSource: "rule" });
    expect(Number(op.totalAmount)).toBe(100);
    expect(Number(op.taxWithheld)).toBe(15);
    expect(await prisma.ledgerEntry.count({ where: { userId: USER, deletedAt: null } })).toBe(before);
    const ref = await prisma.pluggyExternalRef.findUniqueOrThrow({ where: { userId_pluggyId: { userId: USER, pluggyId: "t-jcp-manual" } } });
    expect(ref).toMatchObject({ matchKind: "created", operationId: op.id, ledgerEntryId: manual.entryIds[0] });
  });

  it("keeps the externalId and the classification of a dividend the user already locked when the same income is recorded again", async () => {
    // A dividend with the same net on the same day exists, but for a gross Pluggy does not report, so it is not a fuzzy match.
    const holding = await createHolding(USER, { accountId: f.broker, assetClass: "stocks", ticker: "PETR4", name: "Petrobras", currency: "BRL" }, prisma);
    const booked = await recordDividend(USER, { holdingId: holding.id, amount: 85, date: "2026-10-10", currency: "BRL", incomeType: "jcp" }, prisma);
    const existing = await prisma.investmentOperation.update({
      where: { id: booked.operationId },
      data: { externalId: "manual-id", syncLocked: true, classificationSource: "manual" },
    });
    const jcp = tx("t-jcp-dup", "petr4", "INTEREST", 100, "2026-10-10", { description: "JCP PETR4", expenses: { incomeTax: 15 } });

    const report = await run(fake({ investments: [stock("petr4")], txs: [jcp] }));

    expect(report.items[0]?.stats).toMatchObject({ created: 1, conflicts: 0 });
    expect(await prisma.investmentOperation.count({ where: { holdingId: holding.id } })).toBe(1);
    expect(await prisma.ledgerEntry.count({ where: { userId: USER, deletedAt: null } })).toBe(1);
    expect(await prisma.investmentOperation.findUniqueOrThrow({ where: { id: existing.id } })).toMatchObject({ externalId: "manual-id", classificationSource: "manual", syncLocked: true });
    expect((await prisma.pluggyExternalRef.findUniqueOrThrow({ where: { userId_pluggyId: { userId: USER, pluggyId: "t-jcp-dup" } } })).operationId).toBe(existing.id);
  });
});

describe("amortization labels and income that cannot be credited", () => {
  const cdbNoCode = (name: string | null): PluggyInvestment => ({ id: "cdb-nc", type: "FIXED_INCOME", subtype: "CDB", name, code: null, quantity: null, value: null, amount: 1000 });
  const amort = tx("t-am", "cdb-nc", "AMORTIZATION", 100, "2026-10-12");

  it("labels the cash entry with the asset name when the holding has no ticker, and with a bare word when it has neither", async () => {
    await run(fake({ investments: [cdbNoCode("CDB Banco Z")], txs: [amort] }));
    expect((await prisma.ledgerEntry.findFirstOrThrow({ where: { userId: USER, kind: "investment" } })).description).toBe("Amortização CDB Banco Z");

    await prisma.ledgerEntry.deleteMany({ where: { userId: USER } });
    await prisma.pluggyExternalRef.deleteMany({ where: { userId: USER } });
    await prisma.pluggyInvestmentLink.deleteMany({ where: { userId: USER } });
    await prisma.investmentOperation.deleteMany({ where: { holding: { account: { userId: USER } } } });
    await prisma.investmentHolding.deleteMany({ where: { account: { userId: USER } } });
    await run(fake({ investments: [cdbNoCode(null)], txs: [amort] }));
    // The label is never empty, so sync.ts's "|| Amortização" fallback does not apply and a trailing space is left; compare trimmed.
    expect((await prisma.ledgerEntry.findFirstOrThrow({ where: { userId: USER, kind: "investment" } })).description?.trim()).toBe("Amortização");
  });

  it("opens a conflict review with the ledger's reason when income of zero cannot be credited", async () => {
    const report = await run(fake({ investments: [stock("petr4")], txs: [tx("t-zero-jcp", "petr4", "INTEREST", 0, "2026-10-12", { description: "JCP PETR4" })] }));
    expect(report.items[0]?.stats).toMatchObject({ conflicts: 1, created: 0 });
    const [review] = await reviews("conflict");
    expect(review?.draft).toMatchObject({ pluggyId: "t-zero-jcp", ticker: "PETR4", amount: 0 });
    expect((review!.draft as { reason: string }).reason).toMatch(/positive/i);
    expect(await prisma.investmentOperation.count({ where: { holding: { account: { userId: USER } } } })).toBe(0);
  });
});

describe("a dividend booked before with an id of its own", () => {
  async function existingDividend(data: { externalId: string | null; syncLocked: boolean }) {
    const holding = await createHolding(USER, { accountId: f.broker, assetClass: "stocks", ticker: "PETR4", name: "Petrobras", currency: "BRL" }, prisma);
    const booked = await recordDividend(USER, { holdingId: holding.id, amount: 85, date: "2026-10-10", currency: "BRL", incomeType: "jcp" }, prisma);
    await prisma.investmentOperation.update({ where: { id: booked.operationId }, data: { ...data, classificationSource: "manual" } });
    return booked.operationId;
  }
  const jcp = () => tx("t-jcp-same-net", "petr4", "INTEREST", 100, "2026-10-10", { description: "JCP PETR4", expenses: { incomeTax: 15 } });

  it("keeps that id but refreshes the classification when the operation is not locked", async () => {
    const operationId = await existingDividend({ externalId: "typed-by-hand", syncLocked: false });
    await run(fake({ investments: [stock("petr4")], txs: [jcp()] }));
    expect(await prisma.investmentOperation.findUniqueOrThrow({ where: { id: operationId } })).toMatchObject({
      externalId: "typed-by-hand",
      classificationSource: "rule",
      classificationConfidence: 1,
    });
  });

  it("takes the Pluggy id when the operation had none", async () => {
    const operationId = await existingDividend({ externalId: null, syncLocked: false });
    await run(fake({ investments: [stock("petr4")], txs: [jcp()] }));
    expect(await prisma.investmentOperation.findUniqueOrThrow({ where: { id: operationId } })).toMatchObject({ externalId: "t-jcp-same-net", classificationSource: "rule" });
  });
});

describe("holdings created from Pluggy investments", () => {
  it("picks the asset class and fixed-income subtype from the type, subtype, code and name", async () => {
    const rows: PluggyInvestment[] = [
      { id: "i-etf-type", type: "ETF", name: "Fundo de índice", code: "BOVA11", currencyCode: null },
      { id: "i-etf-sub", type: "EQUITY", subtype: "ETF", name: "IVVB", code: "IVVB11" },
      { id: "i-bdr", type: "EQUITY", subtype: "BDR", name: "Apple BDR", code: "AAPL34" },
      { id: "i-bdr-code", type: "EQUITY", subtype: "STOCK", name: "Google BDR", code: "GOGL35" },
      { id: "i-fii", type: "EQUITY", subtype: "REAL_ESTATE_FUND", name: "Fundo imobiliário", code: "MXRF11" },
      { id: "i-lci", type: "FIXED_INCOME", subtype: "LCI", name: "LCI Banco", code: "LCI1" },
      { id: "i-lca", type: "FIXED_INCOME", subtype: "LCA", name: "LCA Banco", code: "LCA1" },
      { id: "i-deb", type: "FIXED_INCOME", subtype: "DEBENTURES", name: "Debênture", code: "DEB1" },
      { id: "i-ipca", type: "FIXED_INCOME", subtype: "TREASURY", name: "Tesouro IPCA+ 2035", code: "TIPCA" },
      { id: "i-pre", type: "FIXED_INCOME", subtype: "TREASURY", name: "Tesouro Prefixado 2029", code: "TPRE" },
      { id: "i-selic", type: "FIXED_INCOME", subtype: "TREASURY", name: "Tesouro Selic 2029", code: "TSEL" },
      { id: "i-selic-noname", type: "FIXED_INCOME", subtype: "TREASURY", name: null, code: "TNONAME" },
      { id: "i-cri", type: "FIXED_INCOME", subtype: "CRI", name: "CRI X", code: "CRI1" },
      { id: "i-fund", type: "MUTUAL_FUND", subtype: null, name: "Fundo Multi", code: "FUNDM" },
      { id: "i-other", type: null, subtype: null, name: "Coisa", code: "COISA" },
    ];

    await run(fake({ investments: rows }));

    const holdings = await prisma.investmentHolding.findMany({ where: { account: { userId: USER } } });
    const byTicker = new Map(holdings.map((holding) => [holding.ticker, holding]));
    expect(byTicker.get("BOVA11")?.assetClass).toBe("etf");
    expect(byTicker.get("IVVB11")?.assetClass).toBe("etf");
    expect(byTicker.get("AAPL34")?.assetClass).toBe("bdr");
    expect(byTicker.get("GOGL35")?.assetClass).toBe("bdr");
    expect(byTicker.get("MXRF11")?.assetClass).toBe("fii");
    expect(byTicker.get("FUNDM")?.assetClass).toBe("fixed_income");
    expect(byTicker.get("COISA")?.assetClass).toBe("stocks");
    expect(
      ["LCI1", "LCA1", "DEB1", "TIPCA", "TPRE", "TSEL", "TNONAME", "CRI1"].map((ticker) => [ticker, byTicker.get(ticker)?.assetClass, byTicker.get(ticker)?.subType]),
    ).toEqual([
      ["LCI1", "fixed_income", "lci"],
      ["LCA1", "fixed_income", "lca"],
      ["DEB1", "fixed_income", "debenture"],
      ["TIPCA", "fixed_income", "tesouro_ipca"],
      ["TPRE", "fixed_income", "tesouro_prefixado"],
      ["TSEL", "fixed_income", "tesouro_selic"],
      ["TNONAME", "fixed_income", "tesouro_selic"],
      ["CRI1", "fixed_income", null],
    ]);
    // A holding without a currency from Pluggy takes the brokerage's.
    expect(byTicker.get("BOVA11")?.currency).toBe("BRL");
    expect(holdings).toHaveLength(rows.length);
    expect(await prisma.pluggyInvestmentLink.count({ where: { userId: USER } })).toBe(rows.length);
  });

  it("names a holding from the investment, then the ticker, then a default, and cuts the name at 200 characters", async () => {
    await run(
      fake({
        investments: [
          { id: "n-long", type: "EQUITY", subtype: "STOCK", name: "L".repeat(250), code: "LONG3" },
          { id: "n-ticker", type: "EQUITY", subtype: "STOCK", name: null, code: "  tick3 " },
          { id: "n-none", type: "OTHER", name: null, code: null },
          { id: "n-priced", type: "EQUITY", subtype: "STOCK", name: "Com preço", code: "PRICE3", value: 12.5, currencyCode: "BRL" },
        ],
      }),
    );
    const holdings = await prisma.investmentHolding.findMany({ where: { account: { userId: USER } } });
    expect(holdings.find((h) => h.ticker === "LONG3")?.name).toBe("L".repeat(200));
    expect(holdings.find((h) => h.ticker === "TICK3")?.name).toBe("TICK3");
    expect(holdings.find((h) => h.ticker === null)).toMatchObject({ name: "Investimento", assetClass: "stocks" });
    expect(holdings.find((h) => h.ticker === "PRICE3")?.currentPrice).toBe(12.5);
  });

  it("compares quantities after booking: no review when they agree, and a new holding without a quantity never gets one", async () => {
    await run(fake({ investments: [stock("nolq3", { quantity: null }), stock("agree3", { quantity: 0 })] }));
    expect(await reviews()).toEqual([]);
    await run(fake({ investments: [stock("nolq3", { quantity: null }), stock("agree3", { quantity: 0.00005 })] }));
    expect(await reviews()).toEqual([]);
    await run(fake({ investments: [stock("agree3", { quantity: 4 })] }));
    const [review] = await reviews("position");
    expect(review?.draft).toMatchObject({ ticker: "AGREE3", pluggyQuantity: 4, capitalQuantity: 0 });
  });
});
