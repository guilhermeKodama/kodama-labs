import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { createEntry } from "@capital/server/modules/ledger/services/entries";
import { contributions, savingsRate } from "../contributions";
import { currentPeriod } from "../portfolio-history";
import { periodLabel } from "../../lib/portfolio-timeline";

const USER = "test-user-inv-contribedge-001";
const BUSINESS_ONLY = "test-user-inv-contribedge-002";
let f: LedgerFixture;

beforeEach(async () => {
  f = await createLedgerFixture(prisma, USER);
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
  await deleteLedgerFixture(prisma, BUSINESS_ONLY);
});

const transfer = (from: string, to: string, amount: number, date: string, description?: string) =>
  createEntry(USER, { kind: "transfer", fromAccountId: from, toAccountId: to, amount, date, description }, prisma);

/** A checking-account investment with no transfer behind it. */
const bankInvestment = (amount: number, date: string, description: string) =>
  createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount, date, description }, prisma, { kind: "investment" });

/** A plain row on the broker (a leg that can account for a bank investment). */
const brokerLeg = (amount: number, date: string, description: string) =>
  prisma.ledgerEntry.create({
    data: {
      userId: USER,
      entityId: f.pfId,
      accountId: f.broker,
      kind: "investment",
      amount,
      currency: "BRL",
      exchangeRate: 1,
      amountBase: amount,
      date: new Date(`${date}T12:00:00Z`),
      effectiveDate: new Date(`${date}T12:00:00Z`),
      description,
    },
  });

describe("the window", () => {
  it("covers the last twelve months up to the current one when no end or length is given", async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: USER }, select: { timezone: true } });
    const c = await contributions(USER, prisma);
    const current = periodLabel(currentPeriod(user.timezone));
    expect(c.months).toHaveLength(12);
    expect(c.to).toBe(current);
    expect(c.months.at(-1)!.period).toBe(current);
    expect(c).not.toHaveProperty("year");
    expect(c).toMatchObject({ totalNet: 0, averageMonthly: 0, savingsRate: { aportes: 0, income: 0, rate: null } });
  });

  it("refuses an end that is not a month", async () => {
    for (const end of ["2026-13", "2026-1", "outubro", "2026-00"]) {
      await expect(contributions(USER, prisma, { end })).rejects.toMatchObject({ status: 422, code: "validation" });
    }
  });

  it("measures a window of one month, or of the length asked", async () => {
    await transfer(f.pfChecking, f.broker, 700, "2026-10-03");
    const one = await contributions(USER, prisma, { months: 1, end: "2026-10" });
    expect(one).toMatchObject({ from: "2026-10", to: "2026-10", totalNet: 700, averageMonthly: 700 });
    const six = await contributions(USER, prisma, { months: 6, end: "2026-10" });
    expect(six.from).toBe("2026-05");
    expect(six.months.map((m) => m.net)).toEqual([0, 0, 0, 0, 0, 700]);
    expect(six.averageMonthly).toBeCloseTo(700 / 6, 2);
  });
});

describe("origins", () => {
  it("names a transfer by its own description when its group has none", async () => {
    const moved = await transfer(f.pfChecking, f.broker, 400, "2026-10-03", "Aporte do mês");
    await prisma.transferGroup.update({ where: { id: moved.transferGroupId! }, data: { description: null } });
    await prisma.ledgerEntry.updateMany({ where: { transferGroupId: moved.transferGroupId! }, data: { description: "Texto da perna" } });
    const c = await contributions(USER, prisma, { months: 1, end: "2026-10" });
    expect(c.months[0].origins).toEqual([expect.objectContaining({ amount: 400, description: "Texto da perna", defaultDescription: false })]);
  });

  it("treats a transfer whose group and legs have no text as carrying the default description", async () => {
    const moved = await transfer(f.pfChecking, f.broker, 400, "2026-10-03");
    await prisma.transferGroup.update({ where: { id: moved.transferGroupId! }, data: { description: null } });
    await prisma.ledgerEntry.updateMany({ where: { transferGroupId: moved.transferGroupId! }, data: { description: "" } });
    const c = await contributions(USER, prisma, { months: 1, end: "2026-10" });
    expect(c.months[0].origins[0]).toMatchObject({ amount: 400, description: "", defaultDescription: true });
  });
});

describe("a user with no personal entity", () => {
  it("has no savings rate and no PF aportes, whatever moves into the broker", async () => {
    await prisma.user.deleteMany({ where: { id: BUSINESS_ONLY } });
    await prisma.user.create({ data: { id: BUSINESS_ONLY, email: `${BUSINESS_ONLY}@example.com`, passwordHash: "x", name: BUSINESS_ONLY, baseCurrency: "BRL" } });
    const company = await prisma.entity.create({ data: { userId: BUSINESS_ONLY, kind: "business", name: "Só PJ", defaultCurrency: "BRL" } });
    const checking = await prisma.account.create({ data: { userId: BUSINESS_ONLY, entityId: company.id, type: "checking", name: "Conta", currency: "BRL", isDefault: true } });
    const broker = await prisma.account.create({ data: { userId: BUSINESS_ONLY, entityId: company.id, type: "brokerage", name: "Corretora PJ", currency: "BRL" } });
    await createEntry(BUSINESS_ONLY, { kind: "transfer", fromAccountId: checking.id, toAccountId: broker.id, amount: 900, date: "2026-10-03" }, prisma);

    const c = await contributions(BUSINESS_ONLY, prisma, { months: 1, end: "2026-10" });
    expect(c.months[0]).toMatchObject({ deposits: 900, net: 900 });
    expect(c.savingsRate).toEqual({ aportes: 0, income: 0, rate: null });
    expect(await savingsRate(BUSINESS_ONLY, prisma, [], new Date("2026-10-01T00:00:00Z"), new Date("2026-11-01T00:00:00Z"))).toEqual({ aportes: 0, income: 0, rate: null });
  });
});

describe("bank investments", () => {
  it("sums rows of the same day and lists them in a stable order", async () => {
    const a = await bankInvestment(300, "2026-10-05", "Primeira");
    const b = await bankInvestment(200, "2026-10-05", "Segunda");
    const c = await contributions(USER, prisma, { months: 1, end: "2026-10" });
    expect(c.months[0]).toMatchObject({ deposits: 500, withdrawals: 0 });
    // Same day: newest first, then by id descending, whatever order they were created in.
    expect(c.months[0].origins.map((o) => o.entryId)).toEqual([a.entryIds[0], b.entryIds[0]].sort().reverse());
  });

  it("lets each broker leg account for one bank row only, and takes the closest in date, then in amount", async () => {
    // Three broker rows around R$ 100 on the same day: slightly different amounts, all within a cent.
    await brokerLeg(100.004, "2026-10-10", "perna 1");
    await brokerLeg(100.001, "2026-10-10", "perna 2");
    await brokerLeg(100.001, "2026-10-10", "perna 3");
    // And one two days away, which a same-day leg always beats.
    await brokerLeg(100, "2026-10-12", "perna 4");
    for (const description of ["linha A", "linha B", "linha C", "linha D", "linha E"]) await bankInvestment(100, "2026-10-10", description);

    const c = await contributions(USER, prisma, { months: 1, end: "2026-10" });
    const left = c.months[0].origins.filter((o) => o.standalone);
    // Four legs took four rows; the fifth row has no leg left and is an aporte.
    expect(left).toHaveLength(1);
    expect(left[0].amount).toBe(100);
    expect(c.months[0].deposits).toBe(100);
  });

  it("does not match a bank row to a leg in another entity, or more than a cent or three days away", async () => {
    const pjLeg = await prisma.account.create({ data: { userId: USER, entityId: f.pjId, type: "brokerage", name: "BTG", currency: "BRL" } });
    await prisma.ledgerEntry.create({
      data: {
        userId: USER,
        entityId: f.pjId,
        accountId: pjLeg.id,
        kind: "investment",
        amount: 100,
        currency: "BRL",
        exchangeRate: 1,
        amountBase: 100,
        date: new Date("2026-10-10T12:00:00Z"),
        effectiveDate: new Date("2026-10-10T12:00:00Z"),
        description: "outra entidade",
      },
    });
    await brokerLeg(100.02, "2026-10-10", "valor diferente");
    await brokerLeg(100, "2026-10-14", "dias depois");
    await bankInvestment(100, "2026-10-10", "Sem perna");
    const c = await contributions(USER, prisma, { months: 1, end: "2026-10" });
    expect(c.months[0].origins.filter((o) => o.standalone).map((o) => o.description)).toEqual(["Sem perna"]);
    expect(c.months[0].deposits).toBe(100);
  });
});
