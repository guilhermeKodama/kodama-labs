import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture } from "@/test/ledger-fixtures";
import { ledgerGroupSchema } from "../../contracts";
import { createEntry } from "../../services/entries";
import { flowKindJoins, flowKindOf, flowKindSql } from "../flow-sql";
import { loadFx } from "../fx";
import { effectiveCategoryIdSql } from "../income-cash-category";
import { displayAmount, kindSign, nativePlaces, round, roundNative, splitAmount, toDecimal, toNumber } from "../money";
import { ENTRY_CONTEXT_INCLUDE, serializeEntry } from "../serialize";
import { economicDateSql, paceDaySql, spentToDateSql } from "../spend-as-of";

const USER = "test-user-ledger-lib-gaps-001";
const GHOST = "test-user-ledger-lib-gaps-ghost";

beforeEach(async () => {
  await deleteLedgerFixture(prisma, USER);
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

describe("money", () => {
  it("wraps numbers and strings in a Decimal and passes a Decimal through", () => {
    const d = new Prisma.Decimal("12.50");
    expect(toDecimal(d)).toBe(d);
    expect(toDecimal(3).toString()).toBe("3");
    expect(toDecimal("0.1").plus(toDecimal("0.2")).toString()).toBe("0.3");
  });

  it("reads null, numbers and decimals as numbers", () => {
    expect(toNumber(null)).toBe(0);
    expect(toNumber(undefined)).toBe(0);
    expect(toNumber(7.5)).toBe(7.5);
    expect(toNumber(new Prisma.Decimal("-1234.5678"))).toBe(-1234.5678);
    expect(toNumber("9.99")).toBe(9.99);
  });

  it("rounds to places, with cents for BRL and USD and four decimals for the rest", () => {
    expect(round(1.00005, 4)).toBe(1.0001);
    expect(round(2.675, 2)).toBe(2.68);
    expect(round(-2.675, 2)).toBe(-2.67);
    expect(nativePlaces("BRL")).toBe(2);
    expect(nativePlaces("USD")).toBe(2);
    expect(nativePlaces("EUR")).toBe(4);
    expect(roundNative(10.456, "BRL")).toBe(10.46);
    expect(roundNative(10.45678, "EUR")).toBe(10.4568);
  });

  it("signs income as an inflow and everything else as an outflow, and reads the magnitude back", () => {
    expect(kindSign("income")).toBe(1);
    for (const kind of ["expense", "investment", "transfer"] as const) expect(kindSign(kind)).toBe(-1);
    expect(displayAmount("expense", -40)).toBe(40);
    expect(displayAmount("income", "25.5")).toBe(25.5);
    expect(displayAmount("transfer", -300)).toBe(300);
    expect(displayAmount("transfer", new Prisma.Decimal(300))).toBe(300);
  });

  it("splits a total into cents, the last part absorbing the remainder", () => {
    expect(splitAmount(100, 3)).toEqual([33.33, 33.33, 33.34]);
    expect(splitAmount(10, 2)).toEqual([5, 5]);
    const parts = splitAmount(1000.07, 7);
    expect(parts).toHaveLength(7);
    expect(round(parts.reduce((a, b) => a + b, 0), 2)).toBe(1000.07);
  });
});

describe("flow-sql", () => {
  it("falls back to transfer for a kind that is neither income, expense nor investment", () => {
    expect(flowKindOf({ kind: "transfer", transferGroupId: null, direction: null, operationType: null })).toBe("transfer");
  });

  it("builds the joins on the aliases it is given and refuses anything but identifiers", () => {
    const joins = flowKindJoins({ entry: "e2", group: "g2", operation: "o2" });
    expect(joins.sql).toContain("transfer_groups g2");
    expect(joins.sql).toContain('o2."cashEntryId" = e2.id');
    expect(flowKindSql({ entry: "x", group: "y", operation: "z" }).sql).toContain('x."transferGroupId" IS NOT NULL');
    expect(() => flowKindJoins({ group: "g; --" })).toThrow('Invalid SQL alias "g; --"');
    expect(() => flowKindJoins({ entry: "1abc" })).toThrow(/Invalid SQL alias/);
  });
});

describe("income cash category and spend-as-of aliases", () => {
  it("refuse aliases that are not identifiers", () => {
    expect(() => effectiveCategoryIdSql({ entry: "le)" })).toThrow('Invalid SQL alias "le)"');
    expect(() => effectiveCategoryIdSql({ operation: "io OR 1=1" })).toThrow(/Invalid SQL alias/);
    expect(() => economicDateSql("t; drop")).toThrow(/Invalid SQL alias/);
    expect(() => spentToDateSql("t t", new Date())).toThrow(/Invalid SQL alias/);
    expect(() => paceDaySql("-", new Date())).toThrow(/Invalid SQL alias/);
  });

  it("uses the purchase date for card rows and the effective date otherwise, and day 1 for an earlier cycle", () => {
    expect(economicDateSql("le").sql).toContain('WHEN le."cardStatementId" IS NOT NULL THEN le.date ELSE le."effectiveDate"');
    const spent = spentToDateSql("x", new Date("2026-09-10T00:00:00Z"));
    expect(spent.sql).toContain("<= ");
    expect(spent.values).toEqual([new Date("2026-09-10T00:00:00Z")]);
    const pace = paceDaySql("le", new Date("2026-09-01T00:00:00Z"));
    expect(pace.sql).toContain("THEN 1 ELSE extract(day FROM");
    expect(pace.values).toEqual([new Date("2026-09-01T00:00:00Z")]);
  });
});

describe("loadFx", () => {
  it("404s for a user that does not exist", async () => {
    await expect(loadFx(GHOST, prisma)).rejects.toMatchObject({ status: 404, code: "user.not_found" });
  });

  it("answers 1 for the base currency, inverts the stored rate and falls back to 1 for a currency without a positive one", async () => {
    await createLedgerFixture(prisma, USER, { usdRate: 0.25 });
    await prisma.currency.create({ data: { userId: USER, code: "EUR", name: "Euro", symbol: "E", manualRate: 0 } });
    const fx = await loadFx(USER, prisma);
    expect(fx.baseCurrency).toBe("BRL");
    expect(fx.rateFor("BRL")).toBe(1);
    expect(fx.rateFor("USD")).toBe(4);
    expect(fx.rateFor("EUR")).toBe(1);
    expect(fx.rateFor("JPY")).toBe(1);
    expect(fx.hasRate("BRL")).toBe(true);
    expect(fx.hasRate("USD")).toBe(true);
    expect(fx.hasRate("EUR")).toBe(false);
    expect(fx.hasRate("JPY")).toBe(false);
  });

  it("uses today's rate for dated conversions when the base is not BRL, and 1 for the base", async () => {
    await createLedgerFixture(prisma, USER, { baseCurrency: "EUR" });
    await prisma.currency.create({ data: { userId: USER, code: "USD", name: "Dollar", symbol: "$", manualRate: 1.25 } });
    const fx = await loadFx(USER, prisma);
    expect(fx.rateOn("EUR", new Date("2026-09-10T12:00:00Z"))).toBe(1);
    expect(fx.rateOn("USD", new Date("2026-09-10T12:00:00Z"))).toBe(0.8);
  });

  it("uses the previous business day's close for a BRL user, and today's rate when there is none earlier", async () => {
    await createLedgerFixture(prisma, USER, { usdRate: 0.2 });
    const fx = await loadFx(USER, prisma);
    // The migrations seed the PTAX closes (currency_rate_days), which this test only reads.
    const stored = await prisma.currencyRateDay.findMany({ where: { code: "USD" }, orderBy: { date: "asc" }, take: 1 });
    expect(stored).toHaveLength(1);
    expect(fx.rateOn("BRL", new Date("2026-09-10T12:00:00Z"))).toBe(1);
    // A day before any stored close reads today's rate.
    expect(fx.rateOn("USD", new Date("1990-01-01T12:00:00Z"))).toBe(5);
    expect(fx.rateOn("EUR", new Date("1990-01-01T12:00:00Z"))).toBe(1);
    // The day after the first close reads that close, not today's rate.
    const after = new Date(stored[0].date.getTime() + 36 * 3600_000);
    expect(fx.rateOn("USD", after)).toBe(Number(stored[0].brlPerUnit));
  });
});

describe("serializeEntry", () => {
  it("carries the counterpart leg of a transfer and the trash date of a deleted row", async () => {
    const f = await createLedgerFixture(prisma, USER);
    const t = await createEntry(USER, { kind: "transfer", fromAccountId: f.pfChecking, toAccountId: f.broker, amount: 25, date: "2026-09-10" }, prisma);
    const from = await prisma.ledgerEntry.findFirstOrThrow({ where: { id: { in: t.entryIds }, accountId: f.pfChecking }, include: ENTRY_CONTEXT_INCLUDE });
    const row = serializeEntry(from);
    expect(row).toMatchObject({
      accountType: "checking",
      transferDirection: "investment_deposit",
      counterpartAccountId: f.broker,
      counterpartAmount: 25,
      counterpartCurrency: "BRL",
      deletedAt: null,
      isRecurring: false,
      date: "2026-09-10",
    });
    const trashed = serializeEntry({ ...from, deletedAt: new Date("2026-10-01T00:00:00Z"), recurringRuleId: "rule-1" });
    expect(trashed).toMatchObject({ deletedAt: "2026-10-01T00:00:00.000Z", isRecurring: true });
  });

  it("has no counterpart for a simple entry or when the legs were not loaded", async () => {
    const f = await createLedgerFixture(prisma, USER);
    const r = await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 5, date: "2026-09-10", description: "Cafe" }, prisma);
    const e = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: r.entryIds[0] }, include: ENTRY_CONTEXT_INCLUDE });
    expect(serializeEntry(e)).toMatchObject({ transferDirection: null, counterpartAccountId: null, counterpartAmount: null, counterpartCurrency: null });
    const withoutLegs = serializeEntry({ ...e, transferGroup: { direction: "between_accounts" } });
    expect(withoutLegs).toMatchObject({ transferDirection: "between_accounts", counterpartAccountId: null });
  });
});

describe("ledgerGroupSchema", () => {
  it("parses nested groups and refuses a group without a count", () => {
    const group = { key: "2026-09", count: 2, values: { "sum:amountBase": -10 }, children: [{ key: null, count: 1, values: { "sum:amountBase": null } }] };
    expect(ledgerGroupSchema.parse(group)).toEqual(group);
    expect(ledgerGroupSchema.safeParse({ key: "x", values: {} }).success).toBe(false);
  });
});
