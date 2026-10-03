import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { updateBillTransaction } from "../update-bill-transaction";

const db = prisma;
const OWNER_ID = "test-user-bill-tx-owner-001";
const OTHER_ID = "test-user-bill-tx-owner-002";

async function deleteUser(id: string, email: string) {
  const users = await db.user.findMany({
    where: { OR: [{ id }, { email }] },
    select: { id: true },
  });
  for (const user of users) {
    await db.personalAccount.deleteMany({ where: { userId: user.id } });
    await db.user.delete({ where: { id: user.id } });
  }
}

describe("updateBillTransaction statement ownership", () => {
  let purchaseId: string;

  beforeEach(async () => {
    await deleteUser(OWNER_ID, "bill-tx-owner@example.com");
    await deleteUser(OTHER_ID, "bill-tx-other@example.com");

    await db.user.create({
      data: {
        id: OWNER_ID,
        email: "bill-tx-owner@example.com",
        passwordHash: "hash",
        name: "Owner",
      },
    });
    await db.user.create({
      data: {
        id: OTHER_ID,
        email: "bill-tx-other@example.com",
        passwordHash: "hash",
        name: "Other",
      },
    });
    const account = await db.personalAccount.create({
      data: { userId: OWNER_ID, defaultCurrency: "BRL" },
    });
    const card = await db.creditCard.create({
      data: {
        entityType: "personal",
        personalAccountId: account.id,
        bankName: "Nubank",
        lastFourDigits: "5555",
        creditLimit: 1000,
        closingDay: 1,
        dueDay: 10,
        currency: "BRL",
      },
    });
    const statement = await db.creditCardStatement.create({
      data: {
        creditCardId: card.id,
        month: "2026-10",
        closingDate: new Date("2026-10-28T12:00:00.000Z"),
      },
    });
    const purchase = await db.billTransaction.create({
      data: {
        statementId: statement.id,
        category: "Shopping",
        transactionDate: new Date("2026-01-15T12:00:00.000Z"),
        description: "PARC 3/10",
        amount: 40,
        currency: "BRL",
      },
    });
    purchaseId = purchase.id;
  });

  it("lets the owner recategorize a statement purchase and rejects another user", async () => {
    const updated = await updateBillTransaction(OWNER_ID, purchaseId, { category: "Food" }, db);
    expect(updated.category).toBe("Food");

    await expect(
      updateBillTransaction(OTHER_ID, purchaseId, { category: "Transport" }, db)
    ).rejects.toThrow("Bill transaction not found");
  });
});
