import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { createCreditCardTool, listCreditCardsForMcp, updateCreditCardTool } from "../credit-cards";
import { importCreditCardStatement } from "../credit-card-statements";

const USER_A = "test-user-mcp-cards-a";
const USER_B = "test-user-mcp-cards-b";
let a: LedgerFixture;
let b: LedgerFixture;

beforeEach(async () => {
  a = await createLedgerFixture(prisma, USER_A);
  b = await createLedgerFixture(prisma, USER_B);
  await prisma.account.deleteMany({ where: { userId: { in: [USER_A, USER_B] }, type: "credit_card" } });
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER_A);
  await deleteLedgerFixture(prisma, USER_B);
});

const card = (overrides: Record<string, unknown> = {}) => ({
  entityType: "personal" as const,
  bankName: "Nubank",
  lastFourDigits: "3308",
  creditLimit: 8000,
  closingDay: 3,
  dueDay: 10,
  currency: "BRL",
  personalAccountId: a.pfId,
  ...overrides,
});

describe("MCP credit card tools", () => {
  it("lists cards by last 4 and account, including the latest statement month", async () => {
    const personal = await createCreditCardTool(USER_A, card({ nickname: "Personal" }), prisma);
    const business = await createCreditCardTool(USER_A, card({ entityType: "business", personalAccountId: undefined, businessId: a.pjId, bankName: "Itaú", lastFourDigits: "7809" }), prisma);
    expect(personal).toMatchObject({ bankName: "Nubank", nickname: "Personal", lastFourDigits: "3308", personalAccountId: a.pfId, ownerName: "Personal", latestStatementMonth: null, isActive: true });
    expect(business).toMatchObject({ bankName: "Itaú", nickname: null, businessId: a.pjId, ownerName: "Kodama LTDA" });

    await importCreditCardStatement(USER_A, { creditCardId: personal.id, statement: { month: "2026-08" }, rows: [] }, prisma);
    await importCreditCardStatement(USER_A, { creditCardId: personal.id, statement: { month: "2026-09" }, rows: [] }, prisma);

    const by4 = await listCreditCardsForMcp(USER_A, { lastFourDigits: "3308" }, prisma);
    expect(by4.creditCards.map((c) => [c.id, c.latestStatementMonth])).toEqual([[personal.id, "2026-09"]]);
    expect((await listCreditCardsForMcp(USER_A, { accountId: a.pjId }, prisma)).creditCards.map((c) => c.id)).toEqual([business.id]);
    expect((await listCreditCardsForMcp(USER_A, { entityType: "personal" }, prisma)).creditCards.map((c) => c.id)).toEqual([personal.id]);
    await expect(listCreditCardsForMcp(USER_A, { accountId: a.pjId, entityType: "personal" }, prisma)).rejects.toThrow(/does not match/);
  });

  it("does not list, create, or update another user's cards", async () => {
    const mine = await createCreditCardTool(USER_A, card(), prisma);
    expect((await listCreditCardsForMcp(USER_B, {}, prisma)).creditCards).toEqual([]);
    await expect(listCreditCardsForMcp(USER_B, { accountId: a.pfId }, prisma)).rejects.toThrow(/not found/);
    await expect(createCreditCardTool(USER_B, card(), prisma)).rejects.toThrow(/not found/);
    await expect(updateCreditCardTool(USER_B, { id: mine.id, closingDay: 5 }, prisma)).rejects.toThrow(/not found/);
    expect(b.pfId).not.toBe(a.pfId);
  });

  it("validates input like the web API", async () => {
    await expect(createCreditCardTool(USER_A, card({ lastFourDigits: "33" }), prisma)).rejects.toThrow(/4 digits/);
    await expect(createCreditCardTool(USER_A, card({ closingDay: 40 }), prisma)).rejects.toThrow(/closingDay/);
    await expect(createCreditCardTool(USER_A, card({ personalAccountId: undefined }), prisma)).rejects.toThrow(/personalAccountId is required/);
  });

  it("updates last 4 and closing day without changing currency, and hides a duplicate", async () => {
    const c = await createCreditCardTool(USER_A, card({ currency: "USD" }), prisma);
    const u = await updateCreditCardTool(USER_A, { id: c.id, lastFourDigits: "1111", closingDay: 7 }, prisma);
    expect(u).toMatchObject({ lastFourDigits: "1111", closingDay: 7, currency: "USD", nickname: null, bankName: "Nubank" });
    expect((await updateCreditCardTool(USER_A, { id: c.id, isActive: false }, prisma)).isActive).toBe(false);
    expect((await listCreditCardsForMcp(USER_A, {}, prisma)).creditCards[0].isActive).toBe(false);
  });
});
