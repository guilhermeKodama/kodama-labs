import { describe, it, expect, beforeEach } from "vitest";
import { adjustPosition, listInvestmentPositions } from "../investments";
import { prisma } from "@capital/server/lib/prisma";

const db = prisma;

const TEST_USER_ID = "test-user-mcp-inv-002";

describe("MCP Investment Tools", () => {
  let accountId: string;
  let holdingId: string;

  beforeEach(async () => {
    // Clean up test data
    await db.investmentTransaction.deleteMany({
      where: { holding: { account: { userId: TEST_USER_ID } } },
    });
    await db.investmentHolding.deleteMany({
      where: { account: { userId: TEST_USER_ID } },
    });
    await db.investmentAccount.deleteMany({
      where: { userId: TEST_USER_ID },
    });
    await db.personalAccount.deleteMany({ where: { userId: TEST_USER_ID } });
    await db.user.deleteMany({ where: { id: TEST_USER_ID } });

    // Create test user and personal account
    await db.user.create({
      data: {
        id: TEST_USER_ID,
        email: "mcp-inv-test@example.com",
        passwordHash: "test-hash",
        name: "MCP Investment Test User",
        baseCurrency: "BRL",
      },
    });

    await db.personalAccount.create({
      data: {
        userId: TEST_USER_ID,
        defaultCurrency: "BRL",
      },
    });

    // Create investment account
    const account = await db.investmentAccount.create({
      data: {
        userId: TEST_USER_ID,
        name: "XP Investimentos",
        entityType: "personal",
        currency: "BRL",
      },
    });
    accountId = account.id;

    // Create a holding (PMLL11 with 164 cotas at R$ 102.50)
    const holding = await db.investmentHolding.create({
      data: {
        accountId,
        ticker: "PMLL11",
        name: "Maxi Renda FII",
        assetClass: "fii",
        currency: "BRL",
        currentQuantity: 164,
        averageCost: 102.5,
        totalInvested: 16810,
        currentPrice: 105.2,
      },
    });
    holdingId = holding.id;
  });

  describe("listInvestmentPositions", () => {
    it("should list positions with calculated values", async () => {
      const result = await listInvestmentPositions(TEST_USER_ID, db);

      expect(result.positions).toHaveLength(1);
      const position = result.positions[0];

      expect(position.ticker).toBe("PMLL11");
      expect(position.name).toBe("Maxi Renda FII");
      expect(position.assetClass).toBe("fii");
      expect(position.currentQuantity).toBe(164);
      expect(position.averageCost).toBe(102.5);
      expect(position.totalInvested).toBe(16810);
      expect(position.currentPrice).toBe(105.2);
      expect(position.currentValue).toBeCloseTo(17252.8, 1);
      expect(position.unrealizedGain).toBeCloseTo(442.8, 1);
      expect(position.accountName).toBe("XP Investimentos");
    });
  });

  describe("adjustPosition", () => {
    it("should adjust position quantity and average cost", async () => {
      const result = await adjustPosition(
        TEST_USER_ID,
        {
          holdingId,
          currentQuantity: 174,
          averageCost: 102.5,
          notes: "Correcting to match broker statement",
        },
        db
      );

      expect(result.success).toBe(true);
      expect(result.newQuantity).toBe(174);
      expect(result.newAverageCost).toBe(102.5);
      expect(result.newTotalInvested).toBe(17835);

      // Verify the holding was updated
      const holding = await db.investmentHolding.findUnique({
        where: { id: holdingId },
      });
      expect(holding?.currentQuantity).toBe(174);
      expect(holding?.averageCost).toBe(102.5);
      expect(holding?.totalInvested).toBe(17835);

      // Verify audit trail transaction was created
      const adjustmentTxn = await db.investmentTransaction.findFirst({
        where: {
          holdingId,
          type: "adjustment",
        },
      });
      expect(adjustmentTxn).not.toBeNull();
      expect(adjustmentTxn?.quantity).toBe(174);
      expect(adjustmentTxn?.pricePerUnit).toBe(102.5);
      expect(adjustmentTxn?.totalAmount).toBe(17835);
      expect(adjustmentTxn?.notes).toBe("Correcting to match broker statement");
    });

    it("should throw error when holding does not exist", async () => {
      await expect(
        adjustPosition(
          TEST_USER_ID,
          {
            holdingId: "non-existent-id",
            currentQuantity: 174,
            averageCost: 102.5,
          },
          db
        )
      ).rejects.toThrow("Holding not found or access denied");
    });

    it("should throw error when user does not own the holding", async () => {
      const otherUserId = "other-user-001";
      await db.user.upsert({
        where: { id: otherUserId },
        update: {},
        create: {
          id: otherUserId,
          email: "other@example.com",
          passwordHash: "test-hash",
          name: "Other User",
        },
      });

      await expect(
        adjustPosition(
          otherUserId,
          {
            holdingId,
            currentQuantity: 174,
            averageCost: 102.5,
          },
          db
        )
      ).rejects.toThrow("Holding not found or access denied");
    });
  });
});
