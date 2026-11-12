import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { LedgerError } from "@capital/server/modules/ledger/lib/errors";
import { createHolding } from "@capital/server/modules/investments/services/portfolio";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { bookConfirmedIncome } from "../services/sync";

const USER = "test-user-pluggy-confirm-001";
const OTHER = "test-user-pluggy-confirm-002";

let f: LedgerFixture;
let holdingId: string;

beforeEach(async () => {
  f = await createLedgerFixture(prisma, USER);
  await createLedgerFixture(prisma, OTHER);
  holdingId = (await createHolding(USER, { accountId: f.broker, assetClass: "stocks", ticker: "PETR4", name: "Petrobras", currency: "BRL" }, prisma)).id;
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
  await deleteLedgerFixture(prisma, OTHER);
});

const draft = (extra: Record<string, unknown> = {}) => ({
  event: "income",
  pluggyId: "tx-1",
  holdingId,
  incomeType: "dividend",
  origin: "BR",
  gross: 100,
  taxWithheld: 0,
  date: "2026-10-10",
  ...extra,
});

const book = (d: unknown, patch: Parameters<typeof bookConfirmedIncome>[2] = {}, itemRowId: string | null = null, userId = USER) =>
  bookConfirmedIncome(userId, d as Parameters<typeof bookConfirmedIncome>[1], patch, prisma, itemRowId);

const operation = () => prisma.investmentOperation.findFirstOrThrow({ where: { holdingId } });

async function rejection(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(LedgerError);
  return error as LedgerError;
}

describe("bookConfirmedIncome refuses what is not income", () => {
  it("rejects a draft that is not an object, or lacks the fields income needs", async () => {
    for (const bad of [null, "text", 5, [1, 2], {}, draft({ event: "something" }), draft({ holdingId: undefined }), draft({ pluggyId: undefined }), draft({ date: undefined }), draft({ gross: null }), draft({ gross: "100" })]) {
      const error = await rejection(book(bad));
      expect(error).toMatchObject({ status: 422, code: "pluggy.not_income", message: "This review is not an income classification" });
    }
    expect(await prisma.investmentOperation.count({ where: { holdingId } })).toBe(0);
  });

  it("rejects amortization, a sale, a purchase and a skipped row", async () => {
    for (const event of ["amortization", "buy", "sell", "skip"]) {
      const error = await rejection(book(draft({ event })));
      expect(error).toMatchObject({ status: 422, code: "pluggy.not_income", message: "Amortization, a sale or a redemption is not income" });
    }
  });

  it("needs an income type from the draft or from the user", async () => {
    for (const incomeType of [undefined, "salary", 7]) {
      expect(await rejection(book(draft({ incomeType })))).toMatchObject({ code: "pluggy.not_income", message: "Choose the income type" });
    }
    await book(draft({ incomeType: undefined }), { incomeType: "jcp" });
    expect(await operation()).toMatchObject({ incomeType: "jcp", classificationSource: "manual", syncLocked: true });
  });

  it("fails for a holding that is not the user's", async () => {
    await expect(book(draft(), {}, null, OTHER)).rejects.toThrow();
    expect(await prisma.investmentOperation.count({ where: { holdingId } })).toBe(0);
    expect(await prisma.pluggyExternalRef.count({ where: { userId: { in: [USER, OTHER] } } })).toBe(0);
  });
});

describe("bookConfirmedIncome books the dividend", () => {
  it("locks the operation, stores the Pluggy id and remembers it, using the draft's own values", async () => {
    const booked = await book(draft({ origin: "BDR", confidence: 0.55, description: "Provento teste", currency: "BRL", taxWithheld: 0 }));

    const op = await operation();
    expect(op).toMatchObject({
      type: "dividend",
      incomeType: "dividend",
      dividendOrigin: "BDR",
      classificationSource: "manual",
      classificationConfidence: 0.55,
      syncLocked: true,
      externalId: "tx-1",
    });
    expect(Number(op.totalAmount)).toBe(100);
    const cash = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: booked.cashEntryId! } });
    expect(cash).toMatchObject({ accountId: f.broker, description: "Provento teste" });
    expect(Number(cash.amount)).toBe(100);
    const ref = await prisma.pluggyExternalRef.findUniqueOrThrow({ where: { userId_pluggyId: { userId: USER, pluggyId: "tx-1" } } });
    expect(ref).toMatchObject({ matchKind: "created", operationId: op.id, ledgerEntryId: cash.id });
  });

  it("falls back to the holding's currency and a generated description, and stores no confidence when the draft has none", async () => {
    await book(draft({ currency: undefined, description: undefined, confidence: undefined }));
    const op = await operation();
    expect(op.classificationConfidence).toBeNull();
    const cash = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: op.cashEntryId! } });
    expect(cash.currency).toBe("BRL");
    expect(cash.description).toBeTruthy();
  });

  it("lets the user's origin win over the draft's, only for dividends, and drops it for other income types", async () => {
    await book(draft({ origin: "BR" }), { origin: "EXTERIOR" });
    expect((await operation()).dividendOrigin).toBe("EXTERIOR");
    await prisma.investmentOperation.deleteMany({ where: { holdingId } });
    await prisma.pluggyExternalRef.deleteMany({ where: { userId: USER } });

    // A null from the user does not erase the draft's origin.
    await book(draft({ origin: "BDR" }), { origin: null });
    expect((await operation()).dividendOrigin).toBe("BDR");
    await prisma.investmentOperation.deleteMany({ where: { holdingId } });
    await prisma.pluggyExternalRef.deleteMany({ where: { userId: USER } });

    // An origin the draft does not recognise is not stored; the holding's default applies.
    await book(draft({ origin: "MARS" }));
    expect((await operation()).dividendOrigin).toBe("BR");
    await prisma.investmentOperation.deleteMany({ where: { holdingId } });
    await prisma.pluggyExternalRef.deleteMany({ where: { userId: USER } });

    await book(draft({ incomeType: "jcp", origin: "EXTERIOR", taxWithheld: 15 }));
    const jcp = await operation();
    expect(jcp).toMatchObject({ incomeType: "jcp", dividendOrigin: null });
    expect(Number(jcp.taxWithheld)).toBe(15);
  });

  it("withholds nothing on FII income and never more than the gross on the rest", async () => {
    await book(draft({ incomeType: "fii_income", taxWithheld: 5 }));
    expect(Number((await operation()).taxWithheld)).toBe(0);
    await prisma.investmentOperation.deleteMany({ where: { holdingId } });
    await prisma.pluggyExternalRef.deleteMany({ where: { userId: USER } });

    await book(draft({ incomeType: "jcp", taxWithheld: 500 }));
    expect(Number((await operation()).taxWithheld)).toBe(100);
  });

  it("credits the cash account the draft names, but fixed-income interest always lands on the brokerage", async () => {
    await book(draft({ incomeType: "jcp", cashAccountId: f.pfChecking }));
    const op = await operation();
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: op.cashEntryId! } })).accountId).toBe(f.pfChecking);
    await prisma.investmentOperation.deleteMany({ where: { holdingId } });
    await prisma.ledgerEntry.deleteMany({ where: { userId: USER } });
    await prisma.pluggyExternalRef.deleteMany({ where: { userId: USER } });

    await book(draft({ incomeType: "fixed_income_interest", cashAccountId: f.pfChecking }));
    const interest = await operation();
    expect(interest.type).toBe("yield_payment");
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: interest.cashEntryId! } })).accountId).toBe(f.broker);
  });
});

describe("bookConfirmedIncome on a business connection", () => {
  let pjHolding: string;
  let category: string;

  beforeEach(async () => {
    const pjBroker = await prisma.account.create({ data: { userId: USER, entityId: f.pjId, type: "brokerage", name: "Inter PJ", currency: "BRL" } });
    pjHolding = (await createHolding(USER, { accountId: pjBroker.id, assetClass: "fixed_income", subType: "cdb", ticker: "CDBPJ", name: "CDB PJ", currency: "BRL" }, prisma)).id;
    category = (await prisma.category.create({ data: { userId: USER, name: "Renda financeira PJ", type: "income" } })).id;
  });

  const pjDraft = (extra: Record<string, unknown> = {}) => draft({ holdingId: pjHolding, incomeType: "fixed_income_interest", origin: null, pluggyId: "tx-pj", ...extra });
  let counter = 0;
  const item = (entityKind: "personal" | "business", incomeCategoryId: string | null, userId = USER) =>
    prisma.pluggyItem.create({
      data: { userId, label: "Item", itemId: `1111111${(counter += 1)}-1111-4111-8111-111111111111`, entityKind, incomeCategoryId },
    });
  const cashCategory = async () => {
    const op = await prisma.investmentOperation.findFirstOrThrow({ where: { holdingId: pjHolding } });
    return (await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: op.cashEntryId! } })).categoryId;
  };

  it("files the interest under the connection's income category", async () => {
    const row = await item("business", category);
    await book(pjDraft(), {}, row.id);
    expect(await cashCategory()).toBe(category);
  });

  it("leaves the category alone for a personal connection, for other income types, without a category, or for another user's connection", async () => {
    const personal = await item("personal", category);
    await book(pjDraft({ pluggyId: "tx-a" }), {}, personal.id);
    const first = await cashCategory();
    expect(first).not.toBe(category);

    const business = await item("business", category);
    await book(pjDraft({ pluggyId: "tx-b", incomeType: "jcp", date: "2026-09-10" }), {}, business.id);
    const jcp = await prisma.investmentOperation.findFirstOrThrow({ where: { holdingId: pjHolding, externalId: "tx-b" } });
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: jcp.cashEntryId! } })).categoryId).not.toBe(category);

    const bare = await item("business", null);
    await book(pjDraft({ pluggyId: "tx-c", date: "2026-08-10" }), {}, bare.id);
    const noCategory = await prisma.investmentOperation.findFirstOrThrow({ where: { holdingId: pjHolding, externalId: "tx-c" } });
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: noCategory.cashEntryId! } })).categoryId).not.toBe(category);

    const foreign = await item("business", category, OTHER);
    await book(pjDraft({ pluggyId: "tx-d", date: "2026-07-10" }), {}, foreign.id);
    const stranger = await prisma.investmentOperation.findFirstOrThrow({ where: { holdingId: pjHolding, externalId: "tx-d" } });
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: stranger.cashEntryId! } })).categoryId).not.toBe(category);
  });
});
