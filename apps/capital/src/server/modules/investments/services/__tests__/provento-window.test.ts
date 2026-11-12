import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { createHolding, recordOperation } from "../portfolio";
import { proventos12m } from "../proventos";

const USER = "test-user-inv-provwindow-001";
let f: LedgerFixture;

beforeEach(async () => {
  f = await createLedgerFixture(prisma, USER);
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

describe("proventos12m window", () => {
  it("counts the last twelve months only, though it reads a week more to match income against operations", async () => {
    const h = await createHolding(USER, { accountId: f.broker, assetClass: "stocks", ticker: "PETR4", name: "Petrobras" }, prisma);
    await recordOperation(USER, { holdingId: h.id, type: "dividend", incomeType: "dividend", totalAmount: 50, date: daysAgo(10) }, prisma);
    // 368 days ago: inside the week of slack, outside the year.
    await recordOperation(USER, { holdingId: h.id, type: "dividend", incomeType: "dividend", totalAmount: 70, date: daysAgo(368) }, prisma);

    const category = await prisma.category.create({ data: { userId: USER, name: "Proventos", type: "income" } });
    const income = (amount: number, date: string, description: string) =>
      prisma.ledgerEntry.create({
        data: {
          userId: USER,
          entityId: f.pfId,
          accountId: f.pfChecking,
          kind: "income",
          amount,
          currency: "BRL",
          exchangeRate: 1,
          amountBase: amount,
          date: new Date(`${date}T12:00:00Z`),
          effectiveDate: new Date(`${date}T12:00:00Z`),
          description,
          categoryId: category.id,
        },
      });
    await income(33, daysAgo(20), "Rendimento recente");
    await income(44, daysAgo(367), "Rendimento antigo");

    const { total, rows } = await proventos12m(USER, prisma);
    // Newest first: the operation of ten days ago, then the income of twenty.
    expect(rows.map((r) => [r.source, r.totalAmount])).toEqual([
      ["operation", 50],
      ["ledger", 33],
    ]);
    expect(total).toBe(83);
  });
});
