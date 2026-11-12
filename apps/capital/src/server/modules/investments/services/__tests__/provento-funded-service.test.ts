import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { createEntry } from "@capital/server/modules/ledger/services/entries";
import { createHolding, recordOperation } from "../portfolio";
import { brokerageCashAportes } from "../provento-funded";

const USER = "test-user-inv-provfunded-001";
let f: LedgerFixture;

beforeEach(async () => {
  f = await createLedgerFixture(prisma, USER);
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

const END = new Date("2027-01-01T00:00:00Z");

const transfer = (from: string, to: string, amount: number, date: string) =>
  createEntry(USER, { kind: "transfer", fromAccountId: from, toAccountId: to, amount, date }, prisma);

const zeroBase = (entryId: string) => prisma.ledgerEntry.update({ where: { id: entryId }, data: { amountBase: 0 } });

/** An income row booked on the broker itself, in the Proventos category. */
async function brokerIncome(amount: number, amountBase: number, date: string, description: string) {
  const category = (await prisma.category.findFirst({ where: { userId: USER, name: "Proventos" } })) ?? (await prisma.category.create({ data: { userId: USER, name: "Proventos", type: "income" } }));
  const day = new Date(`${date}T12:00:00Z`);
  return prisma.ledgerEntry.create({
    data: {
      userId: USER,
      entityId: f.pfId,
      accountId: f.broker,
      kind: "income",
      amount,
      currency: "BRL",
      exchangeRate: 1,
      amountBase,
      date: day,
      effectiveDate: day,
      description,
      categoryId: category.id,
    },
  });
}

/**
 * One broker, in date order (amounts in R$):
 * 08-01 aporte 10000; 08-05 dividend 500; 08-06 a dividend whose leg is worth nothing, and a ledger Proventos row for the 500
 * the dividend already counted; 08-07 dividend 100 with no net; 08-10 a PETR4 buy of 3000 paid by its own transfer;
 * 08-12 an unfunded buy of 800; 08-14 sales of 1000 and of a leg worth nothing; 08-15 resgate 200; 08-16 a buy and 08-17 a
 * deposit whose legs are worth nothing; 08-20 a Proventos row of 250; 08-22 a Proventos row worth nothing; 08-25 a buy of 400.
 */
async function seed() {
  await transfer(f.pfChecking, f.broker, 10000, "2026-08-01");
  const petr = await createHolding(USER, { accountId: f.broker, assetClass: "stocks", ticker: "PETR4", name: "Petrobras" }, prisma);
  const fund = await createHolding(USER, { accountId: f.broker, assetClass: "fixed_income", name: "Fundo X" }, prisma);

  await recordOperation(USER, { holdingId: petr.id, type: "dividend", incomeType: "dividend", totalAmount: 500, date: "2026-08-05" }, prisma);
  const dust = await recordOperation(USER, { holdingId: petr.id, type: "dividend", incomeType: "dividend", totalAmount: 300, date: "2026-08-06" }, prisma);
  await zeroBase(dust.cashEntryId!);
  await brokerIncome(500, 500, "2026-08-06", "Proventos PETR4");
  const noNet = await recordOperation(USER, { holdingId: petr.id, type: "dividend", incomeType: "dividend", totalAmount: 100, date: "2026-08-07" }, prisma);
  await prisma.investmentOperation.update({ where: { id: noNet.operation.id }, data: { taxWithheld: 100 } });

  await recordOperation(USER, { holdingId: petr.id, type: "buy", quantity: 100, pricePerUnit: 30, totalAmount: 3000, date: "2026-08-10", fundFromAccountId: f.pfChecking }, prisma);
  await recordOperation(USER, { holdingId: fund.id, type: "buy", totalAmount: 800, date: "2026-08-12" }, prisma);

  await recordOperation(USER, { holdingId: petr.id, type: "sell", quantity: 10, pricePerUnit: 100, totalAmount: 1000, date: "2026-08-14" }, prisma);
  const zeroSale = await recordOperation(USER, { holdingId: petr.id, type: "sell", quantity: 1, pricePerUnit: 50, totalAmount: 50, date: "2026-08-14" }, prisma);
  await zeroBase(zeroSale.cashEntryId!);
  await transfer(f.broker, f.pfChecking, 200, "2026-08-15");

  const zeroBuy = await recordOperation(USER, { holdingId: petr.id, type: "buy", quantity: 1, pricePerUnit: 50, totalAmount: 50, date: "2026-08-16" }, prisma);
  await zeroBase(zeroBuy.cashEntryId!);
  const zeroDeposit = await transfer(f.pfChecking, f.broker, 50, "2026-08-17");
  await prisma.ledgerEntry.updateMany({ where: { transferGroupId: zeroDeposit.transferGroupId! }, data: { amountBase: 0 } });

  await brokerIncome(250, 250, "2026-08-20", "Rendimento em conta");
  await brokerIncome(70, 0, "2026-08-22", "Rendimento sem valor");
  await recordOperation(USER, { holdingId: petr.id, type: "buy", quantity: 10, pricePerUnit: 40, totalAmount: 400, date: "2026-08-25" }, prisma);
}

describe("brokerageCashAportes", () => {
  it("walks the broker's cash in date order and reports the purchases paid with provento cash", async () => {
    await seed();
    const rows = await brokerageCashAportes(USER, prisma, null, END);
    // The 3000 buy was paid by its own transfer; the 800 buy spent the 600 of provento cash then at the broker
    // (500 + 100: the dividend with no net still counts its leg); the 400 buy spent the 250 of the later Proventos row.
    // Rows worth nothing and the Proventos row that mirrors the 500 dividend count for nothing.
    expect(rows.map((r) => [r.date, r.label, r.amount, r.period])).toEqual([
      ["2026-08-12", "Fundo X", 600, "2026-08"],
      ["2026-08-25", "PETR4", 250, "2026-08"],
    ]);
    expect(rows[0]).toMatchObject({ entityId: f.pfId, accountId: f.broker, accountName: "XP", entityName: "PF" });
  });

  it("stops at the end of the window but still walks what came before it", async () => {
    await seed();
    const early = await brokerageCashAportes(USER, prisma, null, new Date("2026-08-13T00:00:00Z"));
    expect(early.map((r) => [r.date, r.amount])).toEqual([["2026-08-12", 600]]);
    expect(await brokerageCashAportes(USER, prisma, null, new Date("2026-08-05T00:00:00Z"))).toEqual([]);
  });

  it("limits the walk to the entities in scope", async () => {
    await seed();
    expect(await brokerageCashAportes(USER, prisma, [f.pjId], END)).toEqual([]);
    expect((await brokerageCashAportes(USER, prisma, [f.pfId], END)).map((r) => r.amount)).toEqual([600, 250]);
  });

  it("is empty for a user with no broker activity", async () => {
    expect(await brokerageCashAportes(USER, prisma, null, END)).toEqual([]);
  });
});
