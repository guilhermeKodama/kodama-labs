import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import {
  listCreditCardsForMcp,
  createCreditCardTool,
  updateCreditCardTool,
} from "../credit-cards";

const db = prisma;
const USER_A = "test-user-mcp-cards-a";
const USER_B = "test-user-mcp-cards-b";

async function reset() {
  await db.user.deleteMany({ where: { id: { in: [USER_A, USER_B] } } });
  await db.user.create({
    data: {
      id: USER_A,
      email: "mcp-cards-a@example.com",
      passwordHash: "hash",
      name: "Cards A",
      baseCurrency: "BRL",
    },
  });
  await db.user.create({
    data: {
      id: USER_B,
      email: "mcp-cards-b@example.com",
      passwordHash: "hash",
      name: "Cards B",
      baseCurrency: "BRL",
    },
  });
}

describe("MCP credit card tools", () => {
  let personalA: string;
  let businessA: string;
  let personalB: string;

  beforeEach(async () => {
    await reset();
    personalA = (await db.personalAccount.create({
      data: { userId: USER_A, defaultCurrency: "BRL" },
    })).id;
    businessA = (await db.business.create({
      data: { userId: USER_A, name: "Kodama Labs", defaultCurrency: "BRL" },
    })).id;
    personalB = (await db.personalAccount.create({
      data: { userId: USER_B, defaultCurrency: "BRL" },
    })).id;
  });

  it("lists cards by last 4 and account, including the latest statement month", async () => {
    const personal = await createCreditCardTool(USER_A, {
      entityType: "personal",
      bankName: "Nubank",
      lastFourDigits: "3308",
      nickname: "Personal",
      creditLimit: 8000,
      closingDay: 3,
      dueDay: 10,
      currency: "BRL",
      personalAccountId: personalA,
    }, db);
    const business = await createCreditCardTool(USER_A, {
      entityType: "business",
      bankName: "Nubank",
      lastFourDigits: "7809",
      creditLimit: 20000,
      closingDay: 8,
      dueDay: 15,
      currency: "BRL",
      businessId: businessA,
    }, db);
    await db.creditCardStatement.create({
      data: { creditCardId: personal.id, month: "2026-05" },
    });
    await db.creditCardStatement.create({
      data: { creditCardId: personal.id, month: "2026-09" },
    });

    const byLast4 = await listCreditCardsForMcp(USER_A, { lastFourDigits: "3308" }, db);
    expect(byLast4.creditCards).toHaveLength(1);
    expect(byLast4.creditCards[0]).toMatchObject({
      id: personal.id,
      bankName: "Nubank",
      lastFourDigits: "3308",
      ownerName: "Personal",
      closingDay: 3,
      dueDay: 10,
      currency: "BRL",
      latestStatementMonth: "2026-09",
    });

    const byBusiness = await listCreditCardsForMcp(USER_A, { accountId: businessA }, db);
    expect(byBusiness.creditCards.map((card) => card.id)).toEqual([business.id]);
    expect(byBusiness.creditCards[0].ownerName).toBe("Kodama Labs");
    expect(byBusiness.creditCards[0].latestStatementMonth).toBeNull();
  });

  it("does not list, create, or update another user's cards", async () => {
    const foreign = await createCreditCardTool(USER_B, {
      entityType: "personal",
      bankName: "Nubank",
      lastFourDigits: "3308",
      creditLimit: 1000,
      closingDay: 1,
      dueDay: 8,
      currency: "BRL",
      personalAccountId: personalB,
    }, db);

    const listed = await listCreditCardsForMcp(USER_A, { lastFourDigits: "3308" }, db);
    expect(listed.creditCards).toHaveLength(0);

    await expect(
      listCreditCardsForMcp(USER_A, { accountId: personalB }, db)
    ).rejects.toThrow(/access denied/);

    await expect(
      createCreditCardTool(USER_A, {
        entityType: "personal",
        bankName: "Nubank",
        lastFourDigits: "9999",
        creditLimit: 1000,
        closingDay: 1,
        dueDay: 8,
        currency: "BRL",
        personalAccountId: personalB,
      }, db)
    ).rejects.toThrow(/access denied/);

    await expect(
      updateCreditCardTool(USER_A, { id: foreign.id, lastFourDigits: "1111" }, db)
    ).rejects.toThrow(/Credit card not found/);
  });

  it("updates last 4 and closing day without changing currency", async () => {
    const created = await createCreditCardTool(USER_A, {
      entityType: "personal",
      bankName: "Nubank",
      lastFourDigits: "0000",
      creditLimit: 5000,
      closingDay: 1,
      dueDay: 10,
      currency: "BRL",
      personalAccountId: personalA,
    }, db);

    const updated = await updateCreditCardTool(USER_A, {
      id: created.id,
      bankName: "Nubank",
      nickname: "Personal",
      lastFourDigits: "3308",
      closingDay: 3,
      dueDay: 10,
    }, db);

    expect(updated.lastFourDigits).toBe("3308");
    expect(updated.closingDay).toBe(3);
    expect(updated.nickname).toBe("Personal");
    expect(updated.currency).toBe("BRL");
    expect(updated.creditLimit).toBe(5000);
  });
});
