import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DbClient } from "@capital/server/lib/prisma";
import { validateImportPlanPayload } from "../validate-import-plan-payload";
import { ImportPlanPayloadSchema } from "../../tools/schemas/import-plan-payload";

vi.mock("../../../data/queries/fetch-entity-for-agent", () => ({
  // Every entity referenced in these tests belongs to the user;
  // ownership is covered by the checks around it, not here.
  fetchEntityForAgent: vi.fn().mockResolvedValue({ id: "entity", initialBalance: 0 }),
}));

const USER = "user-1";
const BUSINESS = "biz-1";
const PERSONAL = "pa-1";

/**
 * One OFX row per fitId, which is what the plan's externalIds point at.
 * `type` here is the ground truth every check in the validator is
 * measured against.
 */
const ROWS = [
  { fitId: "row-out", date: "2026-01-10", description: "Pix enviado", fullDescription: "Pix enviado", amount: -1000, type: "expense" as const },
  { fitId: "row-in", date: "2026-01-11", description: "Pix recebido", fullDescription: "Pix recebido", amount: 500, type: "income" as const },
];

function mockDb(parsed: unknown = { kind: "bank_ofx", rows: ROWS }): DbClient {
  return {
    conversationFile: {
      findFirst: vi.fn().mockResolvedValue({ id: "file-1", parseStatus: "parsed", parsedPayload: parsed }),
    },
    transaction: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue(null) },
    transfer: { findMany: vi.fn().mockResolvedValue([]) },
    investmentAccount: { findMany: vi.fn().mockResolvedValue([{ id: "inv-1" }]) },
    investmentHolding: { findMany: vi.fn().mockResolvedValue([]) },
    investmentTransaction: { findMany: vi.fn().mockResolvedValue([]) },
    creditCard: { findFirst: vi.fn().mockResolvedValue(null) },
    creditCardBill: { findFirst: vi.fn().mockResolvedValue(null) },
  } as unknown as DbClient;
}

function plan(overrides: Record<string, unknown> = {}) {
  return ImportPlanPayloadSchema.parse({
    entityType: "business",
    entityId: BUSINESS,
    fileId: "file-1",
    currency: "BRL",
    ...overrides,
  });
}

/** An outgoing profit distribution on a business statement - the shape that used to be written as money coming in. */
function outgoingDistribution(overrides: Record<string, unknown> = {}) {
  return {
    externalId: "row-out",
    date: "2026-01-10",
    amount: 1000,
    flow: "outflow",
    direction: "profit_distribution",
    counterpartyEntityType: "personal",
    counterpartyEntityId: PERSONAL,
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("validateImportPlanPayload - transfer flow", () => {
  it("accepts a transfer whose flow matches the row and whose label matches the sides", async () => {
    const { warnings } = await validateImportPlanPayload(
      USER,
      plan({ transfers: [outgoingDistribution()] }),
      mockDb()
    );
    expect(warnings).toEqual([]);
  });

  // The reported bug: an outflow row saved as money arriving.
  it("rejects a transfer marked as an inflow when the row is an expense", async () => {
    await expect(
      validateImportPlanPayload(
        USER,
        plan({ transfers: [outgoingDistribution({ flow: "inflow", direction: "capital_injection" })] }),
        mockDb()
      )
    ).rejects.toThrow(/marked as an inflow but the statement row is an expense/);
  });

  it("rejects a transfer marked as an outflow when the row is income", async () => {
    await expect(
      validateImportPlanPayload(
        USER,
        plan({
          transfers: [
            outgoingDistribution({ externalId: "row-in", amount: 500, flow: "outflow" }),
          ],
        }),
        mockDb()
      )
    ).rejects.toThrow(/marked as an outflow but the statement row is an income/);
  });

  it("rejects a label that contradicts who paid whom", async () => {
    // Money leaving the business towards the person cannot be the
    // person injecting capital.
    await expect(
      validateImportPlanPayload(
        USER,
        plan({ transfers: [outgoingDistribution({ direction: "capital_injection" })] }),
        mockDb()
      )
    ).rejects.toThrow(/capital_injection.*personal -> business/);
  });

  it("accepts capital_injection when the money arrives in the business", async () => {
    const { warnings } = await validateImportPlanPayload(
      USER,
      plan({
        transfers: [
          outgoingDistribution({
            externalId: "row-in",
            amount: 500,
            flow: "inflow",
            direction: "capital_injection",
          }),
        ],
      }),
      mockDb()
    );
    expect(warnings).toEqual([]);
  });

  it("rejects a transfer whose amount does not match the row", async () => {
    await expect(
      validateImportPlanPayload(
        USER,
        plan({ transfers: [outgoingDistribution({ amount: 999 })] }),
        mockDb()
      )
    ).rejects.toThrow(/amount 999 but the statement row is 1000/);
  });

  it("cannot check the label between two businesses, but still checks the flow", async () => {
    const between = outgoingDistribution({
      counterpartyEntityType: "business",
      counterpartyEntityId: "biz-2",
      direction: "capital_injection",
    });
    await expect(
      validateImportPlanPayload(USER, plan({ transfers: [between] }), mockDb())
    ).resolves.toBeTruthy();
    await expect(
      validateImportPlanPayload(
        USER,
        plan({ transfers: [{ ...between, flow: "inflow" }] }),
        mockDb()
      )
    ).rejects.toThrow(/statement row is an expense/);
  });

  it("warns instead of throwing when the file has no parsed rows to check against", async () => {
    const { warnings } = await validateImportPlanPayload(
      USER,
      plan({ transfers: [outgoingDistribution()] }),
      mockDb(null)
    );
    expect(warnings.join(" ")).toMatch(/could not be checked/);
  });
});

describe("validateImportPlanPayload - transactions", () => {
  it("rejects an expense row typed as income", async () => {
    await expect(
      validateImportPlanPayload(
        USER,
        plan({
          transactions: [
            { externalId: "row-out", date: "2026-01-10", description: "Pix enviado", amount: 1000, type: "income" },
          ],
        }),
        mockDb()
      )
    ).rejects.toThrow(/typed "income" but the statement row is an expense/);
  });

  it("accepts an expense row typed as an expense", async () => {
    const { warnings } = await validateImportPlanPayload(
      USER,
      plan({
        transactions: [
          { externalId: "row-out", date: "2026-01-10", description: "Pix enviado", amount: 1000, type: "expense" },
        ],
      }),
      mockDb()
    );
    expect(warnings).toEqual([]);
  });
});

describe("validateImportPlanPayload - investment transfers", () => {
  it("rejects a deposit sitting on an income row", async () => {
    await expect(
      validateImportPlanPayload(
        USER,
        plan({
          investmentTransfers: [
            { externalId: "row-in", date: "2026-01-11", amount: 500, direction: "investment_deposit", investmentAccountId: "inv-1" },
          ],
        }),
        mockDb()
      )
    ).rejects.toThrow(/investment_deposit.*outflow.*income/);
  });

  it("accepts a withdrawal on an income row", async () => {
    const { warnings } = await validateImportPlanPayload(
      USER,
      plan({
        investmentTransfers: [
          { externalId: "row-in", date: "2026-01-11", amount: 500, direction: "investment_withdrawal", investmentAccountId: "inv-1" },
        ],
      }),
      mockDb()
    );
    expect(warnings).toEqual([]);
  });
});
