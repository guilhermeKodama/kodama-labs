import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma";
import { prisma } from "@capital/server/lib/prisma";
import { previousBusinessDayRate } from "@capital/server/modules/ledger/lib/fx";
import { round } from "@capital/server/modules/ledger/lib/money";
import { replayPosition } from "@capital/server/modules/investments/lib/holding-position";
import { portfolioFxReport } from "@capital/server/modules/investments/lib/portfolio-fx-report";
import { portfolioSummary } from "@capital/server/modules/investments/services/portfolio";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";

const SELL_USER = "test-user-fx-repair-sell-001";
const ADJ_USER = "test-user-fx-repair-adj-001";
const migrationPath = path.resolve(__dirname, "../../../../../../prisma/migrations/20261008150000_portfolio_fx_repair/migration.sql");
const migrationSql = fs.readFileSync(migrationPath, "utf8");

function noon(day: string): Date {
  return new Date(`${day}T12:00:00.000Z`);
}

function psql(sql: string): { status: number; stdout: string; stderr: string } {
  const url = new URL(process.env.DATABASE_URL ?? "");
  const result = spawnSync(
    "psql",
    ["-h", url.hostname, "-p", url.port || "5432", "-U", decodeURIComponent(url.username), "-d", url.pathname.slice(1), "-v", "ON_ERROR_STOP=1", "-X", "-q"],
    { encoding: "utf8", input: sql, env: { ...process.env, PGPASSWORD: decodeURIComponent(url.password) } },
  );
  return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function runMigration(): void {
  const result = psql(migrationSql);
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
}

async function fingerprint(userIds: string[]): Promise<string> {
  const rows = await prisma.$queryRaw<{ line: string }[]>`
    SELECT line FROM (
      SELECT 'a|' || id || '|' || "initialBalance"::text || '|' || "updatedAt"::text AS line
      FROM accounts WHERE "userId" IN (${Prisma.join(userIds)})
      UNION ALL
      SELECT 'e|' || id || '|' || amount::text || '|' || currency || '|' || "exchangeRate"::text || '|' || "amountBase"::text || '|' || coalesce("deletedAt"::text, '') || '|' || "updatedAt"::text
      FROM ledger_entries WHERE "userId" IN (${Prisma.join(userIds)})
      UNION ALL
      SELECT 'o|' || o.id || '|' || coalesce(o."adjustmentMode"::text, '') || '|' || o."updatedAt"::text || '|' || coalesce(o.quantity::text, '') || '|' || o."totalAmount"::text
      FROM investment_operations o
      JOIN investment_holdings h ON h.id = o."holdingId"
      JOIN accounts a ON a.id = h."accountId"
      WHERE a."userId" IN (${Prisma.join(userIds)})
      UNION ALL
      SELECT 'h|' || h.id || '|' || h."currentQuantity"::text || '|' || h."averageCost"::text || '|' || h."totalInvested"::text || '|' || h."isActive"::text || '|' || h."updatedAt"::text
      FROM investment_holdings h
      JOIN accounts a ON a.id = h."accountId"
      WHERE a."userId" IN (${Prisma.join(userIds)})
    ) s ORDER BY 1
  `;
  return rows.map((row) => row.line).join("\n");
}

async function rateOne(userId: string, entityId: string, checkingId: string, brokerId: string, brokerAmount: number, day: string, description: string) {
  const date = noon(day);
  const group = await prisma.transferGroup.create({
    data: { userId, direction: brokerAmount >= 0 ? "investment_deposit" : "investment_withdrawal", date, description },
  });
  const broker = await prisma.ledgerEntry.create({
    data: {
      userId, entityId, accountId: brokerId, kind: "transfer", amount: brokerAmount, currency: "BRL", exchangeRate: 1, amountBase: brokerAmount,
      date, effectiveDate: date, description, transferGroupId: group.id,
    },
  });
  await prisma.ledgerEntry.create({
    data: {
      userId, entityId, accountId: checkingId, kind: "transfer", amount: -brokerAmount, currency: "BRL", exchangeRate: 1, amountBase: -brokerAmount,
      date, effectiveDate: date, description, transferGroupId: group.id,
    },
  });
  return { groupId: group.id, brokerEntryId: broker.id };
}

describe("portfolio fx repair", () => {
  let sell: LedgerFixture;
  let adj: LedgerFixture;
  let avenueId = "";
  let cryptoSellId = "";
  let cryptoAdjId = "";
  let ibkrId = "";
  let nubankId = "";
  let sellOpId = "";
  let adjOpId = "";
  let snapshotLegId = "";
  let caixinhaId = "";

  beforeAll(async () => {
    await prisma.$executeRaw`DELETE FROM legacy.investment_transactions WHERE id = ${"fx-repair-deleted-btc-adj"}`;
    sell = await createLedgerFixture(prisma, SELL_USER, { usdRate: 1 / 4.9935 });
    adj = await createLedgerFixture(prisma, ADJ_USER, { usdRate: 1 / 4.9935 });
    const avenue = await prisma.account.create({
      data: { userId: SELL_USER, entityId: sell.pfId, type: "brokerage", name: "Avenue", currency: "USD", initialBalance: "167225.1200", createdAt: noon("2026-02-08") },
    });
    const cryptoSell = await prisma.account.create({
      data: { userId: SELL_USER, entityId: sell.pfId, type: "brokerage", name: "Crypto Wallet", currency: "USD", initialBalance: "12002", createdAt: noon("2026-08-01") },
    });
    const cryptoAdj = await prisma.account.create({
      data: { userId: ADJ_USER, entityId: adj.pfId, type: "brokerage", name: "Crypto Wallet", currency: "USD", initialBalance: "12002", createdAt: noon("2026-08-01") },
    });
    const ibkr = await prisma.account.create({
      data: { userId: SELL_USER, entityId: sell.pfId, type: "brokerage", name: "IBKR", currency: "USD", initialBalance: "194.3000", createdAt: noon("2026-02-08") },
    });
    const nubank = await prisma.account.create({
      data: { userId: SELL_USER, entityId: sell.pfId, type: "checking", name: "Nubank PF", currency: "BRL", initialBalance: "-2693.7700" },
    });
    avenueId = avenue.id;
    cryptoSellId = cryptoSell.id;
    cryptoAdjId = cryptoAdj.id;
    ibkrId = ibkr.id;
    nubankId = nubank.id;

    await rateOne(SELL_USER, sell.pfId, sell.pfChecking, avenue.id, -168800.12, "2026-08-12", "Avenue withdrawal");
    await rateOne(SELL_USER, sell.pfId, sell.pfChecking, avenue.id, 2575, "2026-09-16", "Avenue deposit");
    await rateOne(SELL_USER, sell.pfId, sell.pfChecking, cryptoSell.id, 10000, "2026-08-20", "Crypto deposit");
    await rateOne(ADJ_USER, adj.pfId, adj.pfChecking, cryptoAdj.id, 10000, "2026-09-01", "Crypto deposit");

    const snapshot = await prisma.ledgerEntry.create({
      data: {
        userId: SELL_USER, entityId: sell.pfId, accountId: avenue.id, kind: "investment", amount: -100, currency: "USD", exchangeRate: "4.9687", amountBase: "-496.8700",
        date: noon("2026-08-03"), effectiveDate: noon("2026-08-03"), description: "Snapshot cash",
      },
    });
    snapshotLegId = snapshot.id;
    // A real USD inflow so the corrected Avenue path is not only the two repaired legs.
    await prisma.ledgerEntry.create({
      data: {
        userId: SELL_USER, entityId: sell.pfId, accountId: avenue.id, kind: "investment", amount: 50, currency: "USD", exchangeRate: "4.9687", amountBase: "248.4350",
        date: noon("2026-08-03"), effectiveDate: noon("2026-08-03"), description: "Unchanged USD inflow",
      },
    });

    const vuaa = await prisma.investmentHolding.create({
      data: { accountId: avenue.id, assetClass: "international_etf", ticker: "VUAA", name: "VUAA", currency: "USD", currentQuantity: 0, averageCost: 0, totalInvested: 0, isActive: false },
    });
    await prisma.investmentOperation.create({
      data: { holdingId: vuaa.id, type: "buy", quantity: 18.672, pricePerUnit: 144.67, totalAmount: 18.672 * 144.67, date: noon("2026-03-02") },
    });
    const vuaaAdj = await prisma.investmentOperation.create({
      data: { holdingId: vuaa.id, type: "adjustment", quantity: -1.3929, pricePerUnit: 148.5, totalAmount: 0, date: noon("2026-04-01") },
    });
    await prisma.$executeRaw`
      INSERT INTO legacy.investment_transactions (id, "holdingId", type, quantity, "pricePerUnit", "totalAmount", fees, date, "updatedAt")
      VALUES (${vuaaAdj.id}, ${vuaa.id}, 'adjustment'::"InvestmentTransactionType", ${-1.3929}, ${148.5}, ${0}, ${0}, ${noon("2026-04-01")}, NOW())
    `;

    const leg = await prisma.investmentHolding.create({
      data: { accountId: avenue.id, assetClass: "international_etf", ticker: "LEG", name: "LEG", currency: "USD", currentQuantity: 2, averageCost: 15, totalInvested: 30, isActive: true },
    });
    await prisma.investmentOperation.create({ data: { holdingId: leg.id, type: "buy", quantity: 10, pricePerUnit: 10, totalAmount: 100, date: noon("2026-03-03") } });
    const legAdj = await prisma.investmentOperation.create({
      data: { holdingId: leg.id, type: "adjustment", quantity: 2, pricePerUnit: 15, totalAmount: 30, date: noon("2026-03-04") },
    });
    await prisma.$executeRaw`
      INSERT INTO legacy.investment_transactions (id, "holdingId", type, quantity, "pricePerUnit", "totalAmount", fees, date, "updatedAt")
      VALUES (${legAdj.id}, ${leg.id}, 'adjustment'::"InvestmentTransactionType", ${2}, ${15}, ${30}, ${0}, ${noon("2026-03-04")}, NOW())
    `;

    const neg = await prisma.investmentHolding.create({
      data: { accountId: avenue.id, assetClass: "stocks", ticker: "NEG", name: "NEG", currency: "USD", currentQuantity: 0, averageCost: 0, totalInvested: 0, isActive: false },
    });
    await prisma.investmentOperation.create({ data: { holdingId: neg.id, type: "buy", quantity: 5, pricePerUnit: 10, totalAmount: 50, date: noon("2026-03-05") } });
    await prisma.investmentOperation.create({ data: { holdingId: neg.id, type: "adjustment", quantity: -1, pricePerUnit: 10, totalAmount: 0, date: noon("2026-03-06") } });

    const kept = await prisma.investmentHolding.create({
      data: { accountId: avenue.id, assetClass: "stocks", ticker: "NEW", name: "NEW", currency: "USD", currentQuantity: 4, averageCost: 20, totalInvested: 80, isActive: true },
    });
    await prisma.investmentOperation.create({ data: { holdingId: kept.id, type: "buy", quantity: 10, pricePerUnit: 10, totalAmount: 100, date: noon("2026-03-07") } });
    await prisma.investmentOperation.create({ data: { holdingId: kept.id, type: "adjustment", quantity: 4, pricePerUnit: 20, totalAmount: 80, date: noon("2026-03-08") } });

    const postV2 = await prisma.investmentHolding.create({
      data: { accountId: avenue.id, assetClass: "stocks", ticker: "POST", name: "POST", currency: "USD", currentQuantity: 99, averageCost: 1, totalInvested: 99, isActive: true },
    });
    await prisma.investmentOperation.create({ data: { holdingId: postV2.id, type: "buy", quantity: 10, pricePerUnit: 10, totalAmount: 100, date: noon("2026-03-09") } });
    await prisma.investmentOperation.create({
      data: { holdingId: postV2.id, type: "adjustment", quantity: -3, pricePerUnit: 10, totalAmount: 30, date: noon("2026-03-10") },
    });
    const mcp = await prisma.investmentHolding.create({
      data: { accountId: avenue.id, assetClass: "stocks", ticker: "MCP", name: "MCP", currency: "USD", currentQuantity: 8, averageCost: 12, totalInvested: 96, isActive: true },
    });
    await prisma.investmentOperation.create({ data: { holdingId: mcp.id, type: "buy", quantity: 5, pricePerUnit: 10, totalAmount: 50, date: noon("2026-03-11") } });
    await prisma.investmentOperation.create({
      data: { holdingId: mcp.id, type: "adjustment", quantity: 8, pricePerUnit: 12, totalAmount: 0, notes: "Manual adjustment via MCP", date: noon("2026-03-12") },
    });

    async function btc(accountId: string, userId: string, entityId: string, buyDay: string) {
      const cash = await prisma.ledgerEntry.create({
        data: {
          userId, entityId, accountId, kind: "investment", amount: -22002, currency: "USD", exchangeRate: 5, amountBase: -110010,
          date: noon(buyDay), effectiveDate: noon(buyDay), description: "BTC buy cash",
        },
      });
      const holding = await prisma.investmentHolding.create({
        data: { accountId, assetClass: "crypto", ticker: "BTC", name: "Bitcoin", currency: "USD", currentQuantity: 0.3667, averageCost: 60000, totalInvested: 22002, isActive: true },
      });
      const buy = await prisma.investmentOperation.create({
        data: { holdingId: holding.id, type: "buy", quantity: 0.3667, pricePerUnit: 60000, totalAmount: 22002, date: noon(buyDay), cashEntryId: cash.id },
      });
      return { holding, buy, cash };
    }

    const sold = await btc(cryptoSell.id, SELL_USER, sell.pfId, "2026-08-21");
    const sellCash = await prisma.ledgerEntry.create({
      data: {
        userId: SELL_USER, entityId: sell.pfId, accountId: cryptoSell.id, kind: "investment", amount: "6757.7500", currency: "USD", exchangeRate: "5.1809", amountBase: round(6757.75 * 5.1809, 4),
        date: noon("2026-09-30"), effectiveDate: noon("2026-09-30"), description: "BTC sell cash",
      },
    });
    const sellOp = await prisma.investmentOperation.create({
      data: { holdingId: sold.holding.id, type: "sell", quantity: 0.0782, pricePerUnit: 86416.23, totalAmount: 6757.75, date: noon("2026-09-30"), cashEntryId: sellCash.id },
    });
    sellOpId = sellOp.id;
    await prisma.$executeRaw`
      INSERT INTO legacy.investment_transactions (id, "holdingId", type, quantity, "pricePerUnit", "totalAmount", fees, date, "updatedAt")
      VALUES (${"fx-repair-deleted-btc-adj"}, ${sold.holding.id}, 'adjustment'::"InvestmentTransactionType", ${-0.0782}, ${86416.23}, ${0}, ${0}, ${noon("2026-10-02")}, NOW())
    `;

    const adjusted = await btc(cryptoAdj.id, ADJ_USER, adj.pfId, "2026-08-15");
    await prisma.investmentHolding.update({ where: { id: adjusted.holding.id }, data: { currentQuantity: 0, averageCost: 0, totalInvested: 0, isActive: false } });
    const adjustment = await prisma.investmentOperation.create({
      data: { holdingId: adjusted.holding.id, type: "adjustment", quantity: -0.0782, pricePerUnit: 86416.23, totalAmount: 0, date: noon("2026-10-02") },
    });
    adjOpId = adjustment.id;
    await prisma.$executeRaw`
      INSERT INTO legacy.investment_transactions (id, "holdingId", type, quantity, "pricePerUnit", "totalAmount", fees, date, "updatedAt")
      VALUES (${adjustment.id}, ${adjusted.holding.id}, 'adjustment'::"InvestmentTransactionType", ${-0.0782}, ${86416.23}, ${0}, ${0}, ${noon("2026-10-02")}, NOW())
    `;

    const ibkrGroup = await prisma.transferGroup.create({ data: { userId: SELL_USER, direction: "investment_deposit", date: noon("2026-05-04"), description: "IBKR deposit" } });
    await prisma.ledgerEntry.create({
      data: {
        userId: SELL_USER, entityId: sell.pfId, accountId: sell.pfChecking, kind: "transfer", amount: -500, currency: "BRL", exchangeRate: 1, amountBase: -500,
        date: noon("2026-05-04"), effectiveDate: noon("2026-05-04"), description: "IBKR deposit", transferGroupId: ibkrGroup.id,
      },
    });
    await prisma.ledgerEntry.create({
      data: {
        userId: SELL_USER, entityId: sell.pfId, accountId: ibkr.id, kind: "transfer", amount: 100, currency: "USD", exchangeRate: 5, amountBase: 500,
        date: noon("2026-05-04"), effectiveDate: noon("2026-05-04"), description: "IBKR deposit", transferGroupId: ibkrGroup.id,
      },
    });
    await prisma.ledgerEntry.create({
      data: {
        userId: SELL_USER, entityId: sell.pfId, accountId: ibkr.id, kind: "investment", amount: -500, currency: "USD", exchangeRate: 5, amountBase: -2500,
        date: noon("2026-05-05"), effectiveDate: noon("2026-05-05"), description: "IBKR buy cash",
      },
    });
    const caixinha = await prisma.ledgerEntry.create({
      data: {
        userId: SELL_USER, entityId: sell.pfId, accountId: sell.pfChecking, kind: "investment", amount: -100, currency: "BRL", exchangeRate: 1, amountBase: -100,
        date: noon("2026-10-01"), effectiveDate: noon("2026-10-01"), description: "Caixinha Empreender",
      },
    });
    caixinhaId = caixinha.id;
  });

  afterAll(async () => {
    await deleteLedgerFixture(prisma, SELL_USER);
    await deleteLedgerFixture(prisma, ADJ_USER);
  });

  it("embeds the fetched PTAX series and does not call the network", async () => {
    expect(migrationSql).toContain("https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoMoedaPeriodo");
    expect(migrationSql).toContain("2026-08-12 -> 2026-08-11 = 5.1285");
    expect(migrationSql).toContain("2026-09-16 -> 2026-09-15 = 5.1490");
    expect(migrationSql).not.toMatch(/dblink|http_get|net\.http|COPY .* FROM PROGRAM/i);
    const embedded = [...migrationSql.matchAll(/\(DATE '(\d{4}-\d{2}-\d{2})', ([0-9.]+)\)/g)].map((match) => [match[1], Number(match[2])] as const);
    expect(embedded).toHaveLength(192);
    const stored = await prisma.currencyRateDay.findMany({ where: { code: "USD" }, orderBy: { date: "asc" } });
    expect(stored.map((row) => [row.date.toISOString().slice(0, 10), Number(row.brlPerUnit)] as const)).toEqual(embedded);
    expect(previousBusinessDayRate(embedded.map(([day, brlPerUnit]) => ({ day, brlPerUnit })), "2026-08-12")).toBe(5.1285);
    expect(previousBusinessDayRate(embedded.map(([day, brlPerUnit]) => ({ day, brlPerUnit })), "2026-09-16")).toBe(5.149);
  });

  it("warns on an unexpected rate-1 leg and still hard-fails a duplicate Avenue leg", async () => {
    const odd = await prisma.account.create({
      data: { userId: SELL_USER, entityId: sell.pfId, type: "brokerage", name: "Odd", currency: "USD" },
    });
    const bad = await rateOne(SELL_USER, sell.pfId, sell.pfChecking, odd.id, 12345.67, "2026-07-01", "Unexpected");
    const warned = await portfolioFxReport(prisma, "precheck", { userId: SELL_USER });
    expect(warned.ok, warned.issues.join("; ")).toBe(true);
    expect(warned.warnings.join("\n")).toMatch(/unexpected rate-1/);
    expect(warned.text).toMatch(/warn\tunexpected rate-1/);
    const duplicate = await rateOne(SELL_USER, sell.pfId, sell.pfChecking, avenueId, -168800.12, "2026-08-12", "Avenue withdrawal duplicate");
    const ambiguous = await portfolioFxReport(prisma, "precheck", { userId: SELL_USER });
    expect(ambiguous.ok).toBe(false);
    expect(ambiguous.issues.join("\n")).toMatch(/more than one Avenue 2026-08-12/);
    await prisma.transferGroup.delete({ where: { id: duplicate.groupId } });
    await prisma.transferGroup.delete({ where: { id: bad.groupId } });
    await prisma.account.delete({ where: { id: odd.id } });
  });

  it("prints the per-account before/after table and the Avenue reconciliation before writing", async () => {
    const report = await portfolioFxReport(prisma, "precheck", { userId: SELL_USER, expectTargets: true });
    expect(report.ok, report.issues.join("; ")).toBe(true);
    expect(report.text).toContain("opening_native_before");
    expect(report.text).toContain("patrimonio_before");
    expect(report.text).toContain("total_aportado_before");
    expect(report.text).toContain("resultado_before");
    expect(report.text).toContain("avenue_reconciliation_usd");
    expect(report.text).toContain("ending_before\t950.0000");
    expect(report.text).toContain("lift\t0.0000");
    expect(report.text).toContain("ending_after\t950.0000");
    expect(report.text).toContain("ending_before_plus_lift\t950.0000");
    expect(report.text).toContain("running\t");
    expect(report.text).toContain("legacy_account\tmissing");
    expect(report.text).toContain("match\tyes");
    expect(report.text).toContain("ptax_day\t2026-08-11\tptax\t5.1285");
    expect(report.text).toContain("ptax_day\t2026-09-15\tptax\t5.149");
    expect(report.text).toMatch(/delta\tVUAA\t2026-04-01\t-1\.3929\t0\t/);
    expect(report.text).toMatch(/delta\tNEG\t2026-03-06\t-1\t0\t/);
    expect(report.text).not.toMatch(/delta\tLEG\t/);
    expect(report.text).not.toMatch(/delta\tMCP\t/);
    expect(report.text).not.toMatch(/delta\tPOST\t/);
    expect(report.text).toMatch(/holding\tVUAA\tqty\t0\t17\.2791\t/);
    expect(report.text).toMatch(/holding\tBTC\tqty\t0\.3667\t0\.2885\t/);
    expect(report.text).not.toMatch(/holding\tLEG\t/);
    const missingAvenue = await portfolioFxReport(prisma, "precheck", { userId: ADJ_USER, expectTargets: true });
    expect(missingAvenue.ok).toBe(false);
    expect(missingAvenue.issues.join("\n")).toMatch(/Avenue 2026-08-12/);
    const avenue = report.after.find((row) => row.name === "Avenue");
    const before = report.before.find((row) => row.name === "Avenue");
    expect(before?.openingNative).toBeCloseTo(167225.12, 2);
    expect(avenue?.openingNative).toBeCloseTo(33414.0337, 2);
    // The untouched −100 snapshot cash leg stays in the balance, so ending cash is 950.
    expect(avenue?.cashNative).toBeCloseTo(950, 2);
    const crypto = report.after.find((row) => row.name === "Crypto Wallet");
    expect(crypto?.openingNative).toBeCloseTo(0, 4);
    expect(crypto?.cashNative).toBeGreaterThanOrEqual(6757.75);
    const rate = previousBusinessDayRate(
      (await prisma.currencyRateDay.findMany({ where: { code: "USD" }, orderBy: { date: "asc" } })).map((row) => ({ day: row.date.toISOString().slice(0, 10), brlPerUnit: Number(row.brlPerUnit) })),
      "2026-08-01",
    );
    expect(crypto && crypto.initialPositions - crypto.openingBrl).toBeCloseTo(22002 * (rate ?? 0), 1);
  });

  it("repairs the listed rows, keeps the sell, and matches the timeline", async () => {
    const sellBefore = await prisma.investmentOperation.findUniqueOrThrow({ where: { id: sellOpId } });
    const adjBefore = await prisma.investmentOperation.findUniqueOrThrow({ where: { id: adjOpId } });
    const snapshotBefore = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: snapshotLegId } });
    const caixinhaBefore = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: caixinhaId } });
    runMigration();

    const avenue = await prisma.account.findUniqueOrThrow({ where: { id: avenueId } });
    expect(Number(avenue.initialBalance)).toBeCloseTo(33414.0337, 4);
    const out = await prisma.ledgerEntry.findFirstOrThrow({ where: { accountId: avenueId, description: "Avenue withdrawal" } });
    const inn = await prisma.ledgerEntry.findFirstOrThrow({ where: { accountId: avenueId, description: "Avenue deposit" } });
    expect(out.currency).toBe("USD");
    expect(Number(out.exchangeRate)).toBeCloseTo(5.1285, 4);
    expect(Number(out.amount)).toBeCloseTo(round(-168800.12 / 5.1285, 4), 4);
    expect(Number(out.amountBase)).toBeCloseTo(-168800.12, 2);
    expect(Number(inn.exchangeRate)).toBeCloseTo(5.149, 4);
    expect(Number(inn.amount)).toBeCloseTo(round(2575 / 5.149, 4), 4);
    expect(Number(inn.amountBase)).toBeCloseTo(2575, 2);

    const snapshotAfter = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: snapshotLegId } });
    expect(snapshotAfter).toMatchObject({ currency: snapshotBefore.currency, amount: snapshotBefore.amount, exchangeRate: snapshotBefore.exchangeRate, amountBase: snapshotBefore.amountBase, deletedAt: null });
    const caixinhaAfter = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: caixinhaId } });
    expect(caixinhaAfter).toMatchObject({ amount: caixinhaBefore.amount, deletedAt: null, description: "Caixinha Empreender" });
    expect(Number((await prisma.account.findUniqueOrThrow({ where: { id: ibkrId } })).initialBalance)).toBeCloseTo(194.3, 4);
    expect(Number((await prisma.account.findUniqueOrThrow({ where: { id: nubankId } })).initialBalance)).toBeCloseTo(-2693.77, 2);

    const crypto = await prisma.account.findUniqueOrThrow({ where: { id: cryptoSellId } });
    expect(Number(crypto.initialBalance)).toBeCloseTo(0, 4);
    const deposit = await prisma.ledgerEntry.findFirstOrThrow({ where: { accountId: cryptoSellId, description: "Crypto deposit" } });
    expect(Number(deposit.amount)).toBeCloseTo(round(10000 / 5.1714, 4), 4);
    expect(Number(deposit.amountBase)).toBeCloseTo(10000, 2);
    const buy = await prisma.investmentOperation.findFirstOrThrow({ where: { holding: { accountId: cryptoSellId, ticker: "BTC" }, type: "buy" } });
    expect(buy.cashEntryId).toBeNull();
    expect(await prisma.ledgerEntry.findFirst({ where: { accountId: cryptoSellId, description: "BTC buy cash" } })).toBeNull();
    const removed = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM portfolio_fx_repair_removed_entry WHERE "operationId" = ${buy.id}`;
    expect(removed).toHaveLength(1);
    const sellAfter = await prisma.investmentOperation.findUniqueOrThrow({ where: { id: sellOpId } });
    expect(sellAfter).toMatchObject({
      quantity: sellBefore.quantity,
      pricePerUnit: sellBefore.pricePerUnit,
      totalAmount: sellBefore.totalAmount,
      date: sellBefore.date,
      cashEntryId: sellBefore.cashEntryId,
      adjustmentMode: null,
    });
    expect(await prisma.investmentOperation.findUnique({ where: { id: "fx-repair-deleted-btc-adj" } })).toBeNull();
    const liveBtc = await prisma.investmentHolding.findFirstOrThrow({ where: { accountId: cryptoSellId, ticker: "BTC" } });
    expect(liveBtc.currentQuantity).toBeCloseTo(0.2885, 4);
    expect(liveBtc.averageCost).toBeCloseTo(60000, 2);
    expect(liveBtc.isActive).toBe(true);

    const other = await prisma.account.findUniqueOrThrow({ where: { id: cryptoAdjId } });
    expect(Number(other.initialBalance)).toBeCloseTo(0, 4);
    expect(await prisma.investmentOperation.findFirst({ where: { holding: { accountId: cryptoAdjId }, type: "sell" } })).toBeNull();
    const adjAfter = await prisma.investmentOperation.findUniqueOrThrow({ where: { id: adjOpId } });
    expect(adjAfter.adjustmentMode).toBe("delta");
    expect(adjAfter.quantity).toBe(adjBefore.quantity);
    expect(adjAfter.totalAmount).toBe(adjBefore.totalAmount);
    expect(adjAfter.date).toEqual(adjBefore.date);
    const adjBtc = await prisma.investmentHolding.findFirstOrThrow({ where: { accountId: cryptoAdjId, ticker: "BTC" } });
    const replayed = replayPosition(await prisma.investmentOperation.findMany({ where: { holdingId: adjBtc.id }, orderBy: [{ date: "asc" }, { createdAt: "asc" }] }));
    expect(adjBtc.currentQuantity).toBeCloseTo(replayed.quantity, 6);
    expect(adjBtc.currentQuantity).toBeCloseTo(0.2885, 4);
    expect(adjBtc.averageCost).toBeCloseTo(60000, 2);
    expect(adjBtc.isActive).toBe(true);

    const vuaa = await prisma.investmentHolding.findFirstOrThrow({ where: { ticker: "VUAA", accountId: avenueId } });
    expect(vuaa.currentQuantity).toBeCloseTo(17.2791, 4);
    expect(vuaa.averageCost).toBeCloseTo(144.67, 2);
    expect(vuaa.isActive).toBe(true);
    const legacyPositive = await prisma.investmentHolding.findFirstOrThrow({ where: { ticker: "LEG", accountId: avenueId } });
    expect(legacyPositive.currentQuantity).toBeCloseTo(2, 4);
    expect(legacyPositive.averageCost).toBeCloseTo(15, 2);
    expect(await prisma.investmentOperation.findFirst({ where: { holdingId: legacyPositive.id, type: "adjustment" } })).toMatchObject({ adjustmentMode: null, quantity: 2 });
    const postV2 = await prisma.investmentHolding.findFirstOrThrow({ where: { ticker: "POST", accountId: avenueId } });
    expect(postV2.currentQuantity).toBeCloseTo(0, 4);
    expect(await prisma.investmentOperation.findFirst({ where: { holdingId: postV2.id, type: "adjustment" } })).toMatchObject({ adjustmentMode: null, quantity: -3 });
    const mcp = await prisma.investmentHolding.findFirstOrThrow({ where: { ticker: "MCP", accountId: avenueId } });
    expect(mcp.currentQuantity).toBeCloseTo(8, 4);
    expect(mcp.averageCost).toBeCloseTo(12, 2);
    expect(await prisma.investmentOperation.findFirst({ where: { holdingId: mcp.id, type: "adjustment" } })).toMatchObject({ adjustmentMode: null });
    const negative = await prisma.investmentHolding.findFirstOrThrow({ where: { ticker: "NEG", accountId: avenueId } });
    expect(negative.currentQuantity).toBeCloseTo(4, 4);
    expect(negative.isActive).toBe(true);
    const kept = await prisma.investmentHolding.findFirstOrThrow({ where: { ticker: "NEW", accountId: avenueId } });
    expect(kept.currentQuantity).toBeCloseTo(4, 4);
    expect(await prisma.investmentOperation.findFirst({ where: { holdingId: kept.id, type: "adjustment" } })).toMatchObject({ adjustmentMode: null, quantity: 4 });

    const verified = await portfolioFxReport(prisma, "verify", { userId: SELL_USER, expectTargets: true });
    expect(verified.ok, verified.issues.join("; ")).toBe(true);
    expect(verified.text).toContain("opening_native_after");
    expect(verified.text).toContain("match\tyes");
    expect(verified.text).toContain("ending_before\t950.0000");
    expect(verified.text).toContain("ending_after\t950.0000");
    expect(verified.text).toMatch(/holding\tBTC\tqty\t0\.3667\t0\.2885\t/);
    expect(verified.text).toMatch(/delta\tVUAA\t/);
    expect(verified.text).toMatch(/delta\tNEG\t/);
    expect(verified.text).not.toMatch(/delta\tLEG\t/);
    const summary = await portfolioSummary(SELL_USER, prisma);
    const total = verified.after.reduce((sum, row) => sum + row.patrimonio, 0);
    const contributed = verified.after.reduce((sum, row) => sum + row.totalAportado, 0);
    expect(contributed).toBeCloseTo(summary.contributed, 1);
    expect(total).toBeCloseTo(summary.netWorth, 1);
    expect(total - contributed).toBeCloseTo(summary.result, 1);
    const otherReport = await portfolioFxReport(prisma, "verify", { userId: ADJ_USER });
    expect(otherReport.ok, otherReport.issues.join("; ")).toBe(true);
    expect(otherReport.text).toContain("sell\tno");
  });

  it("is a no-op on the second run and leaves an unexpected leg unchanged", async () => {
    const odd = await prisma.account.create({
      data: { userId: SELL_USER, entityId: sell.pfId, type: "brokerage", name: "Odd", currency: "USD" },
    });
    const bad = await rateOne(SELL_USER, sell.pfId, sell.pfChecking, odd.id, 12345.67, "2026-07-01", "Unexpected");
    const before = await fingerprint([SELL_USER, ADJ_USER]);
    const backups = await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM portfolio_fx_repair_entry`;
    runMigration();
    expect(await fingerprint([SELL_USER, ADJ_USER])).toBe(before);
    const untouched = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: bad.brokerEntryId } });
    expect(Number(untouched.amount)).toBeCloseTo(12345.67, 2);
    expect(Number(untouched.exchangeRate)).toBe(1);
    expect(untouched.currency).toBe("BRL");
    await prisma.transferGroup.delete({ where: { id: bad.groupId } });
    await prisma.account.delete({ where: { id: odd.id } });
    const backupsAfter = await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM portfolio_fx_repair_entry`;
    expect(backupsAfter[0]?.n).toBe(backups[0]?.n);
    const runs = await prisma.$queryRaw<{ fxLegs: number; btcDetached: number; modes: number; holdings: number }[]>`
      SELECT "fxLegs", "btcDetached", modes, holdings FROM portfolio_fx_repair_run ORDER BY id DESC LIMIT 1
    `;
    expect(runs[0]).toEqual({ fxLegs: 0, btcDetached: 0, modes: 0, holdings: 0 });
    const verified = await portfolioFxReport(prisma, "verify", { userId: SELL_USER, expectTargets: true });
    expect(verified.ok, verified.issues.join("; ")).toBe(true);
  });
});

describe("portfolio fx repair double sale", () => {
  const userId = "test-user-fx-repair-both-001";
  let fixture: LedgerFixture;
  let accountId = "";

  beforeAll(async () => {
    fixture = await createLedgerFixture(prisma, userId, { usdRate: 0.2 });
    const account = await prisma.account.create({
      data: { userId, entityId: fixture.pfId, type: "brokerage", name: "Crypto Both", currency: "USD", initialBalance: 0 },
    });
    accountId = account.id;
    const holding = await prisma.investmentHolding.create({
      data: { accountId, assetClass: "crypto", ticker: "BTC", name: "Bitcoin", currency: "USD", currentQuantity: 0.2885, averageCost: 60000, totalInvested: 17310, isActive: true },
    });
    await prisma.investmentOperation.create({
      data: { holdingId: holding.id, type: "sell", quantity: 0.0782, pricePerUnit: 86416.23, totalAmount: 6757.75, date: noon("2026-09-30") },
    });
    await prisma.investmentOperation.create({
      data: { holdingId: holding.id, type: "adjustment", quantity: -0.0782, pricePerUnit: 86416.23, totalAmount: 0, date: noon("2026-10-02") },
    });
  });

  afterAll(async () => {
    await deleteLedgerFixture(prisma, userId);
  });

  it("hard-fails precheck and the migration when the sell and the adjustment are both live", async () => {
    const report = await portfolioFxReport(prisma, "precheck", { userId });
    expect(report.ok).toBe(false);
    expect(report.issues.join("\n")).toMatch(/both live/);
    const before = await fingerprint([userId]);
    const failed = psql(migrationSql);
    expect(failed.status).not.toBe(0);
    expect(failed.stderr).toMatch(/both live/);
    expect(await fingerprint([userId])).toBe(before);
    expect(await prisma.investmentHolding.findFirstOrThrow({ where: { accountId, ticker: "BTC" } })).toMatchObject({ currentQuantity: 0.2885 });
  });
});
