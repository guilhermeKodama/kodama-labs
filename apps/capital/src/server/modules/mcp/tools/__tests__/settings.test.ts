import { describe, it, expect, beforeEach } from "vitest";
import {
  getUserSettings,
  updateUserSettings,
  getAccountSettings,
  updateAccountSettings,
} from "../settings";
import { prisma } from "@capital/server/lib/prisma";

const db = prisma;

const TEST_USER_ID = "test-user-mcp-settings-001";

describe("MCP settings tools", () => {
  let personalAccountId: string;
  let businessId: string;

  beforeEach(async () => {
    await db.business.deleteMany({ where: { userId: TEST_USER_ID } });
    await db.personalAccount.deleteMany({ where: { userId: TEST_USER_ID } });
    await db.user.deleteMany({ where: { id: TEST_USER_ID } });

    await db.user.create({
      data: {
        id: TEST_USER_ID,
        email: "mcp-settings-test@example.com",
        passwordHash: "test-hash",
        name: "MCP Settings Test User",
        baseCurrency: "USD",
        theme: "dark",
        dateFormat: "yyyy-MM-dd",
        numberFormat: "en-US",
        timezone: "America/Sao_Paulo",
      },
    });

    const personalAccount = await db.personalAccount.create({
      data: {
        userId: TEST_USER_ID,
        defaultCurrency: "USD",
        taxRate: 0.15,
        initialBalance: 1000,
      },
    });
    personalAccountId = personalAccount.id;

    const business = await db.business.create({
      data: {
        userId: TEST_USER_ID,
        name: "Test Business",
        description: "A test business",
        defaultCurrency: "USD",
        color: "#3B82F6",
        taxRate: 0.25,
        initialBalance: 5000,
      },
    });
    businessId = business.id;
  });

  describe("getUserSettings", () => {
    it("should get user settings", async () => {
      const result = await getUserSettings(TEST_USER_ID, db);

      expect(result.baseCurrency).toBe("USD");
      expect(result.theme).toBe("dark");
      expect(result.dateFormat).toBe("yyyy-MM-dd");
      expect(result.numberFormat).toBe("en-US");
      expect(result.timezone).toBe("America/Sao_Paulo");
    });

    it("should throw error for non-existent user", async () => {
      await expect(
        getUserSettings("00000000-0000-0000-0000-000000000000", db)
      ).rejects.toThrow("User not found");
    });
  });

  describe("updateUserSettings", () => {
    it("should update base currency", async () => {
      const result = await updateUserSettings(
        TEST_USER_ID,
        { baseCurrency: "BRL" },
        db
      );

      expect(result.baseCurrency).toBe("BRL");
      expect(result.theme).toBe("dark");
    });

    it("should update multiple settings at once", async () => {
      const result = await updateUserSettings(
        TEST_USER_ID,
        {
          baseCurrency: "EUR",
          theme: "light",
          timezone: "Europe/London",
        },
        db
      );

      expect(result.baseCurrency).toBe("EUR");
      expect(result.theme).toBe("light");
      expect(result.timezone).toBe("Europe/London");
    });

    it("should update only specified fields", async () => {
      const result = await updateUserSettings(
        TEST_USER_ID,
        { theme: "system" },
        db
      );

      expect(result.theme).toBe("system");
      expect(result.baseCurrency).toBe("USD");
    });
  });

  describe("getAccountSettings", () => {
    it("should get personal account settings", async () => {
      const result = await getAccountSettings(
        TEST_USER_ID,
        personalAccountId,
        "personal",
        db
      );

      expect(result.name).toBe("Personal");
      expect(result.entityType).toBe("personal");
      expect(result.defaultCurrency).toBe("USD");
      expect(result.taxRate).toBe(0.15);
      expect(result.initialBalance).toBe(1000);
    });

    it("should get business account settings", async () => {
      const result = await getAccountSettings(
        TEST_USER_ID,
        businessId,
        "business",
        db
      );

      if (result.entityType !== "business") {
        throw new Error("Expected business entity type");
      }

      expect(result.name).toBe("Test Business");
      expect(result.entityType).toBe("business");
      expect(result.description).toBe("A test business");
      expect(result.defaultCurrency).toBe("USD");
      expect(result.color).toBe("#3B82F6");
      expect(result.taxRate).toBe(0.25);
      expect(result.initialBalance).toBe(5000);
    });

    it("should throw error for non-existent personal account", async () => {
      await expect(
        getAccountSettings(
          TEST_USER_ID,
          "00000000-0000-0000-0000-000000000000",
          "personal",
          db
        )
      ).rejects.toThrow("Personal account not found");
    });

    it("should throw error for non-existent business account", async () => {
      await expect(
        getAccountSettings(
          TEST_USER_ID,
          "00000000-0000-0000-0000-000000000000",
          "business",
          db
        )
      ).rejects.toThrow("Business account not found");
    });
  });

  describe("updateAccountSettings", () => {
    it("should update personal account default currency", async () => {
      const result = await updateAccountSettings(
        TEST_USER_ID,
        personalAccountId,
        "personal",
        { defaultCurrency: "BRL" },
        db
      );

      expect(result.defaultCurrency).toBe("BRL");
      expect(result.name).toBe("Personal");
    });

    it("should update business account name and currency", async () => {
      const result = await updateAccountSettings(
        TEST_USER_ID,
        businessId,
        "business",
        {
          name: "Updated Business",
          defaultCurrency: "EUR",
        },
        db
      );

      expect(result.name).toBe("Updated Business");
      expect(result.defaultCurrency).toBe("EUR");
    });

    it("should update business account description and color", async () => {
      const result = await updateAccountSettings(
        TEST_USER_ID,
        businessId,
        "business",
        {
          description: "New description",
          color: "#FF5733",
        },
        db
      );

      if (!("description" in result)) {
        throw new Error("Expected business result with description");
      }

      expect(result.description).toBe("New description");
      expect(result.color).toBe("#FF5733");
    });

    it("should not affect existing transactions when changing currency", async () => {
      await db.transaction.create({
        data: {
          entityType: "personal",
          type: "expense",
          amount: 100,
          currency: "USD",
          exchangeRate: 1,
          description: "Old transaction in USD",
          category: "Test",
          date: new Date("2026-09-15"),
          personalAccountId,
        },
      });

      await updateAccountSettings(
        TEST_USER_ID,
        personalAccountId,
        "personal",
        { defaultCurrency: "BRL" },
        db
      );

      const transaction = await db.transaction.findFirst({
        where: { personalAccountId },
      });
      expect(transaction?.currency).toBe("USD");
    });

    it("should throw error for non-existent personal account", async () => {
      await expect(
        updateAccountSettings(
          TEST_USER_ID,
          "00000000-0000-0000-0000-000000000000",
          "personal",
          { defaultCurrency: "BRL" },
          db
        )
      ).rejects.toThrow("Personal account not found");
    });

    it("should throw error for non-existent business account", async () => {
      await expect(
        updateAccountSettings(
          TEST_USER_ID,
          "00000000-0000-0000-0000-000000000000",
          "business",
          { name: "New Name" },
          db
        )
      ).rejects.toThrow("Business account not found");
    });
  });
});
