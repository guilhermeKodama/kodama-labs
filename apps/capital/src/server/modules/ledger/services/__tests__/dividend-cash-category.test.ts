import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { displayAmount, toNumber } from "@capital/server/modules/ledger/lib/money";
import { accountBalances } from "@capital/server/modules/ledger/services/accounts";
import { createEntry } from "@capital/server/modules/ledger/services/entries";
import { cashflowSankey } from "@capital/server/modules/ledger/services/flows";
import { queryLedger } from "@capital/server/modules/ledger/services/query-engine";
import { createHolding, recordOperation } from "@capital/server/modules/investments/services/portfolio";
import { proventos12m } from "@capital/server/modules/investments/services/proventos";
import { convertIncomeToDividend, recordDividend } from "@capital/server/modules/investments/services/dividends";

/**
 * Dividend and yield cash legs stay kind=investment (one cash row, the
 * operation's leg) and are categorized as income: Proventos for FII,
 * dividend and JCP; Rendimentos for fixed income. A category the user
 * already set is kept. Legacy nulls read the same way, and the backfill
 * writes that category once.
 */
const USER = "test-user-dividend-cash-category-001";
const OCT = { from: "2026-10-01", to: "2026-10-31" };
const migrationSql = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../../prisma/migrations/20261109140000_dividend_cash_category_backfill/migration.sql"),
  "utf8",
);

let f: LedgerFixture;
let proventosId: string;
let dividendosId: string;
let rendimentosId: string;
let interestId: string;

const legIds = {
  fii: "",
  jcp: "",
  fixed: "",
  legacyDividend: "",
  legacyYield: "",
  chosen: "",
  deleted: "",
  buy: "",
  plain: "",
  convertedNamed: "",
  convertedBlank: "",
};

const balance = async (accountId: string) => (await accountBalances(USER, prisma, [accountId])).get(accountId) ?? 0;

beforeAll(async () => {
  f = await createLedgerFixture(prisma, USER);
  const proventos = await prisma.category.create({ data: { userId: USER, name: "Proventos", type: "income" } });
  const dividendos = await prisma.category.create({ data: { userId: USER, name: "Dividendos", type: "income", systemKey: "dividends", isSystem: true } });
  const rendimentos = await prisma.category.create({ data: { userId: USER, name: "Rendimentos", type: "income" } });
  const interest = await prisma.category.create({ data: { userId: USER, name: "Juros", type: "income", systemKey: "interest", isSystem: true } });
  proventosId = proventos.id;
  dividendosId = dividendos.id;
  rendimentosId = rendimentos.id;
  interestId = interest.id;

  const btlg = await createHolding(USER, { accountId: f.broker, assetClass: "fii", ticker: "BTLG11", name: "BTLG11" }, prisma);
  const petr = await createHolding(USER, { accountId: f.broker, assetClass: "stocks", ticker: "PETR4", name: "Petrobras" }, prisma);
  const cdb = await createHolding(USER, { accountId: f.broker, assetClass: "fixed_income", ticker: "CDB1", name: "CDB" }, prisma);
  const hglg = await createHolding(USER, { accountId: f.broker, assetClass: "fii", ticker: "HGLG11", name: "HGLG11" }, prisma);

  const credit = async (holdingId: string, amount: number, incomeType: "fii_income" | "dividend" | "jcp" | "fixed_income_interest", description: string, withholdingTax = 0) => {
    const result = await recordDividend(USER, { holdingId, amount, date: "2026-10-23", currency: "BRL", incomeType, description, withholdingTax }, prisma);
    return result.cashEntryId!;
  };

  legIds.fii = await credit(btlg.id, 135.27, "fii_income", "Rendimentos BTLG11 23/10");
  legIds.jcp = await credit(petr.id, 100, "jcp", "JCP PETR4 23/10", 15);
  legIds.fixed = await credit(cdb.id, 40, "fixed_income_interest", "Rendimento CDB 23/10");
  legIds.legacyDividend = await credit(btlg.id, 8.88, "dividend", "Dividendo sem tipo 23/10");
  legIds.legacyYield = await credit(cdb.id, 18.5, "fixed_income_interest", "Yield sem tipo 23/10");
  legIds.chosen = await credit(btlg.id, 12.34, "dividend", "Dividendo marcado 23/10");
  legIds.deleted = await credit(btlg.id, 7.77, "fii_income", "Provento apagado 23/10");
  await prisma.ledgerEntry.update({ where: { id: legIds.chosen }, data: { categoryId: f.categories.Salary } });
  await prisma.ledgerEntry.update({ where: { id: legIds.deleted }, data: { deletedAt: new Date("2026-10-24T00:00:00.000Z") } });
  await prisma.investmentOperation.updateMany({ where: { cashEntryId: legIds.legacyDividend }, data: { incomeType: null } });
  await prisma.investmentOperation.updateMany({ where: { cashEntryId: legIds.legacyYield }, data: { incomeType: null } });

  const buy = await recordOperation(USER, { holdingId: btlg.id, type: "buy", quantity: 1, pricePerUnit: 10, totalAmount: 10, date: "2026-10-23" }, prisma);
  legIds.buy = buy.cashEntryId!;

  const plain = await createEntry(USER, { kind: "income", accountId: f.pfChecking, amount: 9.99, date: "2026-08-02", description: "Avulso" }, prisma, { skipRules: true });
  legIds.plain = plain.entryIds[0];

  const named = await createEntry(
    USER,
    { kind: "income", accountId: f.pfChecking, amount: 22.22, date: "2026-09-12", description: "Rendimentos HGLG11", categoryId: proventosId },
    prisma,
    { skipRules: true },
  );
  const checkingBefore = await balance(f.pfChecking);
  const entriesBefore = await prisma.ledgerEntry.count({ where: { userId: USER } });
  const linked = await convertIncomeToDividend(USER, { transactionId: named.entryIds[0], holdingId: hglg.id, incomeType: "fii_income" }, prisma);
  legIds.convertedNamed = linked.cashEntryId!;
  const blank = await createEntry(USER, { kind: "income", accountId: f.pfChecking, amount: 33, date: "2026-09-18", description: "Dividendo PETR4" }, prisma, { skipRules: true });
  const linkedBlank = await convertIncomeToDividend(USER, { transactionId: blank.entryIds[0], holdingId: petr.id, incomeType: "dividend" }, prisma);
  legIds.convertedBlank = linkedBlank.cashEntryId!;
  expect(await prisma.ledgerEntry.count({ where: { userId: USER } })).toBe(entriesBefore + 1);
  expect(await balance(f.pfChecking)).toBeCloseTo(checkingBefore + 33, 2);
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

describe("dividend cash categories", () => {
  it("stores Proventos or Rendimentos on the cash leg and keeps a category that was already chosen", async () => {
    const rows = await prisma.ledgerEntry.findMany({ where: { id: { in: Object.values(legIds) } } });
    const categoryOf = new Map(rows.map((row) => [row.id, row.categoryId]));
    const amountOf = new Map(rows.map((row) => [row.id, toNumber(row.amount)]));

    expect(categoryOf.get(legIds.fii)).toBe(proventosId);
    expect(categoryOf.get(legIds.jcp)).toBe(proventosId);
    expect(categoryOf.get(legIds.legacyDividend)).toBe(proventosId);
    expect(categoryOf.get(legIds.deleted)).toBe(proventosId);
    expect(categoryOf.get(legIds.fixed)).toBe(rendimentosId);
    expect(categoryOf.get(legIds.legacyYield)).toBe(rendimentosId);
    expect(categoryOf.get(legIds.chosen)).toBe(f.categories.Salary);
    expect(categoryOf.get(legIds.buy)).toBeNull();
    expect(categoryOf.get(legIds.convertedNamed)).toBe(proventosId);
    expect(categoryOf.get(legIds.convertedBlank)).toBe(proventosId);

    // Named Proventos wins over the seeded Dividendos row; Rendimentos over the interest system key.
    expect(proventosId).not.toBe(dividendosId);
    expect(rendimentosId).not.toBe(interestId);

    for (const id of [legIds.fii, legIds.jcp, legIds.fixed, legIds.chosen]) {
      const row = rows.find((entry) => entry.id === id)!;
      expect(row.kind).toBe("investment");
      expect(amountOf.get(id)).toBeGreaterThan(0);
      // MCP list_transactions prints investment legs with the opposite sign. The ledger does not.
      expect(displayAmount(row.kind, row.amount)).toBeCloseTo(-amountOf.get(id)!, 2);
    }
    expect(amountOf.get(legIds.fii)).toBeCloseTo(135.27, 2);
    expect(amountOf.get(legIds.jcp)).toBeCloseTo(85, 2);

    const yields = await proventos12m(USER, prisma);
    const again = await proventos12m(USER, prisma);
    expect(again.total).toBe(yields.total);
    expect(yields.rows.filter((row) => row.source === "ledger")).toEqual([]);
    expect(yields.rows.filter((row) => row.ticker === "BTLG11").reduce((sum, row) => sum + row.amountBase, 0)).toBeCloseTo(135.27 + 8.88 + 12.34 + 7.77, 2);
  });

  it("reads a legacy null category as Proventos or Rendimentos in Fluxo de Caixa, once", async () => {
    const brokerBefore = await balance(f.broker);
    const yieldsBefore = (await proventos12m(USER, prisma)).total;
    const legacy = [legIds.fii, legIds.jcp, legIds.fixed, legIds.legacyDividend, legIds.legacyYield, legIds.deleted];
    await prisma.ledgerEntry.updateMany({ where: { id: { in: legacy } }, data: { categoryId: null } });

    expect(await balance(f.broker)).toBeCloseTo(brokerBefore, 2);
    expect((await proventos12m(USER, prisma)).total).toBeCloseTo(yieldsBefore, 2);

    const display = await queryLedger(USER, { semantics: "display", period: OCT }, prisma);
    const byDescription = new Map(display.rows.map((row) => [row.description, row]));
    expect(byDescription.get("Rendimentos BTLG11 23/10")).toMatchObject({ categoryId: proventosId, flowKind: "in", displayAmount: 135.27 });
    expect(byDescription.get("JCP PETR4 23/10")).toMatchObject({ categoryId: proventosId, flowKind: "in", displayAmount: 85 });
    expect(byDescription.get("Dividendo sem tipo 23/10")).toMatchObject({ categoryId: proventosId, flowKind: "in", displayAmount: 8.88 });
    expect(byDescription.get("Rendimento CDB 23/10")).toMatchObject({ categoryId: rendimentosId, flowKind: "in", displayAmount: 40 });
    expect(byDescription.get("Yield sem tipo 23/10")).toMatchObject({ categoryId: rendimentosId, flowKind: "in", displayAmount: 18.5 });
    expect(byDescription.get("Dividendo marcado 23/10")).toMatchObject({ categoryId: f.categories.Salary, flowKind: "in", displayAmount: 12.34 });
    expect(byDescription.has("Provento apagado 23/10")).toBe(false);
    const buy = [...byDescription.values()].find((row) => row.id === legIds.buy);
    expect(buy).toMatchObject({ categoryId: null, flowKind: "invest" });

    // Entradas count each cash leg once. 135.27 + 85 + 8.88 + 40 + 18.50 + 12.34.
    expect(display.summary).toMatchObject({ expense: 0 });
    expect(display.summary!.income).toBeCloseTo(135.27 + 85 + 8.88 + 40 + 18.5 + 12.34, 2);

    const none = await queryLedger(USER, { semantics: "display", period: OCT, filters: [{ field: "categoryId", op: "in", values: [null] }] }, prisma);
    expect(none.rows.map((row) => row.description)).not.toEqual(expect.arrayContaining(["Rendimentos BTLG11 23/10", "Rendimento CDB 23/10"]));
    const proventos = await queryLedger(
      USER,
      { semantics: "display", period: OCT, filters: [{ field: "categoryId", op: "in", values: [proventosId] }] },
      prisma,
    );
    expect(proventos.rows.map((row) => row.description).sort()).toEqual(["Dividendo sem tipo 23/10", "JCP PETR4 23/10", "Rendimentos BTLG11 23/10"]);
    expect(proventos.summary).toMatchObject({ income: 229.15, expense: 0, investment: 0 });

    // isNull is the stored category, so a legacy null is still findable for a data repair.
    const storedNull = await queryLedger(USER, { period: OCT, filters: [{ field: "categoryId", op: "isNull" }] }, prisma);
    expect(storedNull.rows.map((row) => row.id)).toEqual(expect.arrayContaining([legIds.fii, legIds.buy]));

    const legs = await queryLedger(USER, { semantics: "legs", period: OCT, filters: [{ field: "description", op: "contains", value: "BTLG11 23/10" }] }, prisma);
    expect(legs.rows.map((row) => row.categoryId)).toEqual([null]);

    const found = await queryLedger(USER, { semantics: "display", period: OCT, search: "Proventos" }, prisma);
    expect(found.rows.map((row) => row.description).sort()).toEqual(["Dividendo sem tipo 23/10", "JCP PETR4 23/10", "Rendimentos BTLG11 23/10"]);

    await prisma.category.update({ where: { id: proventosId }, data: { isArchived: true } });
    const archived = await queryLedger(USER, { semantics: "display", period: OCT, search: "BTLG11 23/10" }, prisma);
    expect(archived.rows[0].categoryId).toBe(dividendosId);
    await prisma.category.update({ where: { id: proventosId }, data: { isArchived: false } });

    const sankey = await cashflowSankey(USER, { period: OCT }, prisma);
    const pf = `entity::${f.pfId}`;
    const link = (fromId: string) => {
      const from = sankey.nodes.findIndex((node) => node.id === fromId);
      const to = sankey.nodes.findIndex((node) => node.id === pf);
      return sankey.links.filter((item) => item.source === from && item.target === to).reduce((sum, item) => sum + item.value, 0);
    };
    expect(link(`income::${proventosId}`)).toBeCloseTo(135.27 + 85 + 8.88, 2);
    expect(link(`income::${rendimentosId}`)).toBeCloseTo(40 + 18.5, 2);
    expect(link(`income::${f.categories.Salary}`)).toBeCloseTo(12.34, 2);
    expect(sankey.nodes.some((node) => node.id === "income::none")).toBe(false);
    expect(sankey.totals.income).toBeCloseTo(135.27 + 85 + 8.88 + 40 + 18.5 + 12.34, 2);
  });

  it("backfills every null dividend and yield cash leg once and leaves everything else", async () => {
    const candidateWhere = {
      userId: USER,
      categoryId: null,
      investmentOperation: { is: { type: { in: ["dividend" as const, "yield_payment" as const] } } },
    };
    const before = await prisma.ledgerEntry.count({ where: candidateWhere });
    // The six October legs nulled above, including the trashed one. The buy, the
    // plain income and the dividend already filed as Salary are not candidates.
    expect(before).toBe(6);

    class Rollback extends Error {}
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(migrationSql);
        const fii = await tx.ledgerEntry.findUniqueOrThrow({ where: { id: legIds.fii } });
        const fixed = await tx.ledgerEntry.findUniqueOrThrow({ where: { id: legIds.fixed } });
        const legacyDividend = await tx.ledgerEntry.findUniqueOrThrow({ where: { id: legIds.legacyDividend } });
        const legacyYield = await tx.ledgerEntry.findUniqueOrThrow({ where: { id: legIds.legacyYield } });
        const deleted = await tx.ledgerEntry.findUniqueOrThrow({ where: { id: legIds.deleted } });
        const chosen = await tx.ledgerEntry.findUniqueOrThrow({ where: { id: legIds.chosen } });
        const buy = await tx.ledgerEntry.findUniqueOrThrow({ where: { id: legIds.buy } });
        const plain = await tx.ledgerEntry.findUniqueOrThrow({ where: { id: legIds.plain } });
        expect(fii.categoryId).toBe(proventosId);
        expect(legacyDividend.categoryId).toBe(proventosId);
        expect(deleted.categoryId).toBe(proventosId);
        expect(deleted.deletedAt).not.toBeNull();
        expect(fixed.categoryId).toBe(rendimentosId);
        expect(legacyYield.categoryId).toBe(rendimentosId);
        expect(chosen.categoryId).toBe(f.categories.Salary);
        expect(buy.categoryId).toBeNull();
        expect(plain.categoryId).toBeNull();
        expect(await tx.ledgerEntry.count({ where: candidateWhere })).toBe(0);

        await tx.$executeRawUnsafe(migrationSql);
        const fiiAgain = await tx.ledgerEntry.findUniqueOrThrow({ where: { id: legIds.fii } });
        expect(fiiAgain.categoryId).toBe(proventosId);
        expect(await tx.ledgerEntry.count({ where: candidateWhere })).toBe(0);
        expect((await accountBalances(USER, tx, [f.broker])).get(f.broker)).toBeCloseTo(await balance(f.broker), 2);
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);

    // The rolled-back migration did not write the category, so the predicate is unchanged.
    expect(await prisma.ledgerEntry.count({ where: candidateWhere })).toBe(6);
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: legIds.fii } })).categoryId).toBeNull();
  });
});
