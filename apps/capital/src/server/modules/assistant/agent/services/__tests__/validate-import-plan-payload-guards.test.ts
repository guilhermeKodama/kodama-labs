import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DbClient } from "@capital/server/lib/prisma";
import { validateImportPlanPayload } from "../validate-import-plan-payload";
import { ImportPlanPayloadSchema } from "../../tools/schemas/import-plan-payload";
import { fetchEntityForAgent } from "../../../data/queries/fetch-entity-for-agent";

/**
 * The guards of validateImportPlanPayload that sit around the row checks
 * (see validate-import-plan-payload.test.ts for those): who owns what,
 * stale plans, and the warnings. The database is a set of mocks so each
 * test decides what "exists" and asserts how the validator asked for it;
 * validate-import-plan-payload.integration.test.ts runs the same guards
 * against real rows.
 */

vi.mock("../../../data/queries/fetch-entity-for-agent", () => ({
  fetchEntityForAgent: vi.fn(),
}));

const USER = "user-1";
const BUSINESS = "biz-1";
const PERSONAL = "pa-1";

const ROWS = [
  { fitId: "row-out", date: "2026-01-10", description: "Pix enviado", fullDescription: "Pix enviado", amount: -1000, type: "expense" as const },
  { fitId: "row-in", date: "2026-01-11", description: "Pix recebido", fullDescription: "Pix recebido", amount: 500, type: "income" as const },
];

interface DbOverrides {
  file?: unknown;
  ledgerFindMany?: unknown[];
  ledgerFindFirst?: unknown;
  accounts?: Array<{ id: string }>;
  card?: unknown;
  holdings?: Array<{ id: string }>;
  operations?: unknown[];
  transferGroups?: Array<{ id: string }>;
  cardStatement?: unknown;
}

function mockDb(overrides: DbOverrides = {}) {
  const db = {
    conversationFile: {
      findFirst: vi.fn().mockResolvedValue(
        "file" in overrides ? overrides.file : { id: "file-1", parseStatus: "parsed", parsedPayload: { kind: "bank_ofx", rows: ROWS } }
      ),
    },
    ledgerEntry: {
      findMany: vi.fn().mockResolvedValue(overrides.ledgerFindMany ?? []),
      findFirst: vi.fn().mockResolvedValue("ledgerFindFirst" in overrides ? overrides.ledgerFindFirst : null),
    },
    transferGroup: { findMany: vi.fn().mockResolvedValue(overrides.transferGroups ?? []) },
    account: {
      findMany: vi.fn().mockResolvedValue(overrides.accounts ?? [{ id: "inv-1" }]),
      findFirst: vi.fn().mockResolvedValue("card" in overrides ? overrides.card : { id: "card-1" }),
    },
    investmentHolding: { findMany: vi.fn().mockResolvedValue(overrides.holdings ?? []) },
    investmentOperation: { findMany: vi.fn().mockResolvedValue(overrides.operations ?? []) },
    cardStatement: { findFirst: vi.fn().mockResolvedValue("cardStatement" in overrides ? overrides.cardStatement : null) },
  };
  return db;
}

const asDb = (db: ReturnType<typeof mockDb>) => db as unknown as DbClient;

function plan(overrides: Record<string, unknown> = {}) {
  return ImportPlanPayloadSchema.parse({
    entityType: "business",
    entityId: BUSINESS,
    fileId: "file-1",
    currency: "BRL",
    ...overrides,
  });
}

const expenseRow = (overrides: Record<string, unknown> = {}) => ({
  externalId: "row-out",
  date: "2026-01-10",
  description: "Pix enviado",
  amount: 1000,
  type: "expense",
  ...overrides,
});

const distribution = (overrides: Record<string, unknown> = {}) => ({
  externalId: "row-out",
  date: "2026-01-10",
  amount: 1000,
  flow: "outflow",
  direction: "profit_distribution",
  counterpartyEntityType: "personal",
  counterpartyEntityId: PERSONAL,
  ...overrides,
});

const investmentTx = (overrides: Record<string, unknown> = {}) => ({
  externalId: "inv-op-1",
  accountId: "inv-1",
  holdingId: "hold-1",
  type: "buy",
  quantity: 10,
  pricePerUnit: 5,
  totalAmount: 50,
  date: "2026-01-12",
  ...overrides,
});

const bill = (overrides: Record<string, unknown> = {}) => ({
  fileId: "bill-file",
  creditCardId: "card-1",
  closingDate: "2026-03-05",
  dueDate: "2026-03-12",
  previewTotalAmount: 100,
  previewTransactionCount: 2,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchEntityForAgent).mockResolvedValue({
    id: "entity",
    name: "Entity",
    defaultCurrency: "BRL",
    initialBalance: 0,
    accountId: "acc",
  });
});

describe("the entity and the file", () => {
  it("refuses an entity the user does not own, before touching anything else", async () => {
    vi.mocked(fetchEntityForAgent).mockResolvedValueOnce(null);
    const db = mockDb();

    await expect(validateImportPlanPayload(USER, plan(), asDb(db))).rejects.toThrow(
      "business entity biz-1 not found or access denied"
    );

    expect(fetchEntityForAgent).toHaveBeenCalledWith(USER, "business", BUSINESS, db);
    expect(db.conversationFile.findFirst).not.toHaveBeenCalled();
  });

  it("requires a fileId on a plan the assistant proposes", async () => {
    const db = mockDb();
    await expect(validateImportPlanPayload(USER, plan({ fileId: undefined }), asDb(db))).rejects.toThrow(
      "fileId is required when the assistant proposes an import plan"
    );
    expect(db.conversationFile.findFirst).not.toHaveBeenCalled();
  });

  it("refuses a file that is not the user's", async () => {
    const db = mockDb({ file: null });

    await expect(validateImportPlanPayload(USER, plan(), asDb(db))).rejects.toThrow(
      "File file-1 not found or access denied"
    );

    expect(db.conversationFile.findFirst).toHaveBeenCalledWith({
      where: { id: "file-1", userId: USER },
      select: { id: true, parseStatus: true, parsedPayload: true },
    });
  });
});

describe("rows that cannot be checked against the file", () => {
  it("treats the rows of a card file as unverifiable (its parsed kind is card_csv)", async () => {
    const db = mockDb({ file: { id: "file-1", parseStatus: "parsed", parsedPayload: { kind: "card_csv", rows: [] } } });

    const { warnings } = await validateImportPlanPayload(USER, plan({ transactions: [expenseRow()] }), asDb(db));

    expect(warnings).toEqual([
      "1 row(s) could not be checked against the file's parsed rows (row-out) - their amount and direction are taken on trust.",
    ]);
  });

  it("ignores the parsed rows of a file whose parse did not finish", async () => {
    const db = mockDb({ file: { id: "file-1", parseStatus: "failed", parsedPayload: { kind: "bank_ofx", rows: ROWS } } });

    const { warnings } = await validateImportPlanPayload(
      USER,
      // The amount is wrong against the row, but nothing is checked against a failed parse.
      plan({ transactions: [expenseRow({ amount: 1 })] }),
      asDb(db)
    );

    expect(warnings.join(" ")).toMatch(/1 row\(s\) could not be checked/);
  });

  it("lists at most three ids in the warning and elides the rest", async () => {
    const db = mockDb({ file: { id: "file-1", parseStatus: "parsed", parsedPayload: { kind: "bank_ofx", rows: [] } } });
    const transactions = ["a", "b", "c", "d", "e"].map((id) => expenseRow({ externalId: id }));

    const { warnings } = await validateImportPlanPayload(USER, plan({ transactions }), asDb(db));

    expect(warnings).toEqual([
      "5 row(s) could not be checked against the file's parsed rows (a, b, c, ...) - their amount and direction are taken on trust.",
    ]);
  });

  it("counts transfers and investment transfers whose row is not in the file", async () => {
    const db = mockDb({ file: { id: "file-1", parseStatus: "parsed", parsedPayload: { kind: "bank_ofx", rows: [] } } });

    const { warnings } = await validateImportPlanPayload(
      USER,
      plan({
        transfers: [distribution({ externalId: "t-1" })],
        investmentTransfers: [
          { externalId: "i-1", date: "2026-01-11", amount: 500, direction: "investment_deposit", investmentAccountId: "inv-1" },
        ],
      }),
      asDb(db)
    );

    expect(warnings[0]).toContain("2 row(s) could not be checked against the file's parsed rows (t-1, i-1)");
    expect(warnings[0]).not.toContain("...");
  });
});

describe("amounts against the statement row", () => {
  it("rejects a transaction whose amount differs from the row by more than a cent", async () => {
    const db = mockDb();
    await expect(
      validateImportPlanPayload(USER, plan({ transactions: [expenseRow({ amount: 999.98 })] }), asDb(db))
    ).rejects.toThrow("Transaction row-out has amount 999.98 but the statement row is 1000");
  });

  it("accepts a transaction that agrees to the cent", async () => {
    const db = mockDb();
    const { warnings } = await validateImportPlanPayload(
      USER,
      plan({ transactions: [expenseRow({ amount: 1000.004 })] }),
      asDb(db)
    );
    expect(warnings).toEqual([]);
  });

  it("rejects an investment transfer whose amount differs from the row", async () => {
    const db = mockDb();
    await expect(
      validateImportPlanPayload(
        USER,
        plan({
          investmentTransfers: [
            { externalId: "row-out", date: "2026-01-10", amount: 900, direction: "investment_deposit", investmentAccountId: "inv-1" },
          ],
        }),
        asDb(db)
      )
    ).rejects.toThrow("Investment transfer row-out has amount 900 but the statement row is 1000");
  });

  it("accepts an investment deposit on the outgoing row", async () => {
    const db = mockDb();
    const { warnings } = await validateImportPlanPayload(
      USER,
      plan({
        investmentTransfers: [
          { externalId: "row-out", date: "2026-01-10", amount: 1000, direction: "investment_deposit", investmentAccountId: "inv-1" },
        ],
      }),
      asDb(db)
    );
    expect(warnings).toEqual([]);
  });
});

describe("stale plans", () => {
  it("rejects a new transaction whose externalId already exists for the entity", async () => {
    const db = mockDb({ ledgerFindMany: [{ externalId: "row-out" }] });

    await expect(
      validateImportPlanPayload(USER, plan({ transactions: [expenseRow()] }), asDb(db))
    ).rejects.toThrow("1 transaction(s) with these externalIds already exist for this entity - the plan is stale, re-run reconcile_statement");

    expect(db.ledgerEntry.findMany).toHaveBeenCalledWith({
      where: { userId: USER, entityId: BUSINESS, deletedAt: null, externalId: { in: ["row-out"] } },
      select: { externalId: true },
    });
  });

  it("does not look for collisions when the plan has no new transactions", async () => {
    const db = mockDb();
    await validateImportPlanPayload(USER, plan({ transfers: [distribution()] }), asDb(db));
    expect(db.ledgerEntry.findMany).not.toHaveBeenCalled();
  });

  it("rejects an investment transaction already recorded on its holding", async () => {
    const db = mockDb({ holdings: [{ id: "hold-1" }], operations: [{ holdingId: "hold-1", externalId: "inv-op-1" }] });

    await expect(
      validateImportPlanPayload(USER, plan({ investmentTransactions: [investmentTx()] }), asDb(db))
    ).rejects.toThrow("1 investment transaction(s) with these externalIds already exist for their holding - the plan is stale");

    expect(db.investmentOperation.findMany).toHaveBeenCalledWith({
      where: { OR: [{ holdingId: "hold-1", externalId: "inv-op-1" }] },
      select: { holdingId: true, externalId: true },
    });
  });

  it("does not look for investment collisions when every transaction creates a new holding", async () => {
    const db = mockDb();
    await validateImportPlanPayload(
      USER,
      plan({
        investmentTransactions: [
          investmentTx({
            holdingId: undefined,
            newHolding: { assetClass: "stocks", ticker: "PETR4", name: "Petrobras", currency: "BRL" },
          }),
        ],
      }),
      asDb(db)
    );
    expect(db.investmentOperation.findMany).not.toHaveBeenCalled();
    expect(db.investmentHolding.findMany).not.toHaveBeenCalled();
  });
});

describe("link_fuzzy decisions", () => {
  const fuzzy = (overrides: Record<string, unknown> = {}) => ({
    externalId: "row-out",
    resolution: "link_fuzzy",
    existingTransactionId: "tx-9",
    ...overrides,
  });

  it("requires the existing transaction to link to", async () => {
    const db = mockDb();
    await expect(
      validateImportPlanPayload(USER, plan({ duplicateDecisions: [fuzzy({ existingTransactionId: undefined })] }), asDb(db))
    ).rejects.toThrow('duplicateDecisions entry for externalId row-out has resolution "link_fuzzy" but no existingTransactionId');
    expect(db.ledgerEntry.findFirst).not.toHaveBeenCalled();
  });

  it("rejects a target that is not the user's or is in the trash", async () => {
    const db = mockDb({ ledgerFindFirst: null });

    await expect(
      validateImportPlanPayload(USER, plan({ duplicateDecisions: [fuzzy()] }), asDb(db))
    ).rejects.toThrow("link_fuzzy target transaction tx-9 not found or access denied");

    expect(db.ledgerEntry.findFirst).toHaveBeenCalledWith({
      where: { id: "tx-9", userId: USER, deletedAt: null },
      select: { externalId: true },
    });
  });

  it("rejects a target that already carries an externalId", async () => {
    const db = mockDb({ ledgerFindFirst: { externalId: "other-fit" } });
    await expect(
      validateImportPlanPayload(USER, plan({ duplicateDecisions: [fuzzy()] }), asDb(db))
    ).rejects.toThrow("link_fuzzy target transaction tx-9 already has an externalId - it is not an unlinked fuzzy match");
  });

  it("accepts a target without an externalId", async () => {
    const db = mockDb({ ledgerFindFirst: { externalId: null } });
    const { warnings } = await validateImportPlanPayload(USER, plan({ duplicateDecisions: [fuzzy()] }), asDb(db));
    expect(warnings).toContain("This plan has nothing to write - every row was a plain skip.");
  });

  it("does not look up targets for the other resolutions", async () => {
    const db = mockDb();
    await validateImportPlanPayload(
      USER,
      plan({
        duplicateDecisions: [
          { externalId: "a", resolution: "skip_duplicate" },
          { externalId: "b", resolution: "import_anyway" },
        ],
      }),
      asDb(db)
    );
    expect(db.ledgerEntry.findFirst).not.toHaveBeenCalled();
  });
});

describe("transfer counterparties", () => {
  it("rejects a counterparty the user does not own", async () => {
    vi.mocked(fetchEntityForAgent)
      .mockResolvedValueOnce({ id: BUSINESS, name: "B", defaultCurrency: "BRL", initialBalance: 0, accountId: "acc" })
      .mockResolvedValueOnce(null);
    const db = mockDb();

    await expect(
      validateImportPlanPayload(USER, plan({ transfers: [distribution()] }), asDb(db))
    ).rejects.toThrow("Transfer counterparty personal pa-1 not found or access denied");

    expect(fetchEntityForAgent).toHaveBeenLastCalledWith(USER, "personal", PERSONAL, db);
  });

  it("checks each distinct counterparty once", async () => {
    const db = mockDb({
      file: { id: "file-1", parseStatus: "parsed", parsedPayload: { kind: "bank_ofx", rows: [] } },
    });

    await validateImportPlanPayload(
      USER,
      plan({
        transfers: [
          distribution({ externalId: "t-1" }),
          distribution({ externalId: "t-2" }),
          distribution({ externalId: "t-3", counterpartyEntityId: "pa-2" }),
        ],
      }),
      asDb(db)
    );

    // The entity itself, then pa-1 and pa-2 once each.
    expect(vi.mocked(fetchEntityForAgent).mock.calls.map((c) => [c[1], c[2]])).toEqual([
      ["business", BUSINESS],
      ["personal", PERSONAL],
      ["personal", "pa-2"],
    ]);
  });
});

describe("investment accounts and holdings", () => {
  it("rejects an investment transfer to an account that is not a brokerage of the user", async () => {
    const db = mockDb({ accounts: [] });

    await expect(
      validateImportPlanPayload(
        USER,
        plan({
          investmentTransfers: [
            { externalId: "row-out", date: "2026-01-10", amount: 1000, direction: "investment_deposit", investmentAccountId: "inv-1" },
          ],
        }),
        asDb(db)
      )
    ).rejects.toThrow("Investment account inv-1 not found or access denied");

    expect(db.account.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["inv-1"] }, userId: USER, type: "brokerage" },
      select: { id: true },
    });
  });

  it("checks the accounts of investment transactions together with those of the transfers, once each", async () => {
    const db = mockDb({ accounts: [{ id: "inv-1" }, { id: "inv-2" }], holdings: [{ id: "hold-1" }] });

    await validateImportPlanPayload(
      USER,
      plan({
        investmentTransfers: [
          { externalId: "row-out", date: "2026-01-10", amount: 1000, direction: "investment_deposit", investmentAccountId: "inv-1" },
        ],
        investmentTransactions: [investmentTx({ accountId: "inv-1" }), investmentTx({ externalId: "inv-op-2", accountId: "inv-2" })],
      }),
      asDb(db)
    );

    expect(db.account.findMany).toHaveBeenCalledTimes(1);
    expect(db.account.findMany.mock.calls[0]![0].where.id.in).toEqual(["inv-1", "inv-2"]);
  });

  it("rejects an investment transaction on an account that is not the user's", async () => {
    const db = mockDb({ accounts: [] });
    await expect(
      validateImportPlanPayload(USER, plan({ investmentTransactions: [investmentTx()] }), asDb(db))
    ).rejects.toThrow("Investment account inv-1 not found or access denied");
  });

  it("rejects a holding that belongs to another user's account", async () => {
    const db = mockDb({ holdings: [] });

    await expect(
      validateImportPlanPayload(USER, plan({ investmentTransactions: [investmentTx()] }), asDb(db))
    ).rejects.toThrow("Investment holding hold-1 not found or access denied");

    expect(db.investmentHolding.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["hold-1"] }, account: { userId: USER } },
      select: { id: true },
    });
  });

  it("requires a holdingId or a newHolding on every investment transaction", async () => {
    const db = mockDb();
    await expect(
      validateImportPlanPayload(
        USER,
        plan({ investmentTransactions: [investmentTx({ holdingId: undefined })] }),
        asDb(db)
      )
    ).rejects.toThrow("investmentTransactions entry for externalId inv-op-1 has neither holdingId nor newHolding");
  });

  it("accepts an investment transaction on an owned holding", async () => {
    const db = mockDb({ holdings: [{ id: "hold-1" }] });
    const { warnings } = await validateImportPlanPayload(
      USER,
      plan({ investmentTransactions: [investmentTx()] }),
      asDb(db)
    );
    expect(warnings).toEqual([]);
  });
});

describe("reconciliation targets", () => {
  it("rejects a reconciled transaction that is not the user's", async () => {
    const db = mockDb({ ledgerFindMany: [{ id: "tx-1" }] });

    await expect(
      validateImportPlanPayload(
        USER,
        plan({
          reconciliations: [
            { existingTransactionId: "tx-1", externalId: "row-out", updates: { amount: 10 } },
            { existingTransactionId: "tx-2", externalId: "row-in", updates: { date: "2026-01-11" } },
          ],
        }),
        asDb(db)
      )
    ).rejects.toThrow("Reconciliation target transaction tx-2 not found or access denied");

    expect(db.ledgerEntry.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["tx-1", "tx-2"] }, userId: USER, deletedAt: null },
      select: { id: true },
    });
  });

  it("accepts reconciliations whose targets all belong to the user", async () => {
    const db = mockDb({ ledgerFindMany: [{ id: "tx-1" }] });
    const { warnings } = await validateImportPlanPayload(
      USER,
      plan({ reconciliations: [{ existingTransactionId: "tx-1", externalId: "row-out", updates: { amount: 10 } }] }),
      asDb(db)
    );
    expect(warnings).toEqual([]);
  });

  it("rejects a reconciled transfer that is not the user's", async () => {
    const db = mockDb({ transferGroups: [] });

    await expect(
      validateImportPlanPayload(
        USER,
        plan({ transferReconciliations: [{ existingTransferId: "tg-1", externalId: "row-out", updates: { amount: 10 } }] }),
        asDb(db)
      )
    ).rejects.toThrow("Transfer reconciliation target tg-1 not found or access denied");

    expect(db.transferGroup.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["tg-1"] }, userId: USER, deletedAt: null },
      select: { id: true },
    });
  });

  it("accepts reconciled transfers that belong to the user", async () => {
    const db = mockDb({ transferGroups: [{ id: "tg-1" }] });
    const { warnings } = await validateImportPlanPayload(
      USER,
      plan({ transferReconciliations: [{ existingTransferId: "tg-1", externalId: "row-out", updates: { direction: "reimbursement" } }] }),
      asDb(db)
    );
    expect(warnings).toEqual([]);
  });
});

describe("bills", () => {
  it("requires exactly one of creditCardId and newCreditCard", async () => {
    const db = mockDb();
    const neither = bill({ creditCardId: undefined });
    const both = bill({ newCreditCard: { bankName: "Nubank", lastFourDigits: "1234", closingDay: 5, dueDay: 12, currency: "BRL" } });

    await expect(validateImportPlanPayload(USER, plan({ bills: [neither] }), asDb(db))).rejects.toThrow(
      "bills entry (fileId bill-file) must set exactly one of creditCardId or newCreditCard"
    );
    await expect(validateImportPlanPayload(USER, plan({ bills: [both] }), asDb(db))).rejects.toThrow(
      "bills entry (fileId bill-file) must set exactly one of creditCardId or newCreditCard"
    );
  });

  it("rejects a bill whose file is not the user's", async () => {
    const db = mockDb();
    db.conversationFile.findFirst.mockResolvedValueOnce({ id: "file-1", parseStatus: "parsed", parsedPayload: null }).mockResolvedValueOnce(null);

    await expect(validateImportPlanPayload(USER, plan({ bills: [bill()] }), asDb(db))).rejects.toThrow(
      "File bill-file not found or access denied"
    );

    expect(db.conversationFile.findFirst).toHaveBeenLastCalledWith({
      where: { id: "bill-file", userId: USER },
      select: { id: true },
    });
  });

  it("rejects a bill on a card that is not a credit card of the user", async () => {
    const db = mockDb({ card: null });

    await expect(validateImportPlanPayload(USER, plan({ bills: [bill()] }), asDb(db))).rejects.toThrow(
      "Credit card card-1 not found or access denied"
    );

    expect(db.account.findFirst).toHaveBeenCalledWith({
      where: { id: "card-1", userId: USER, type: "credit_card" },
      select: { id: true },
    });
  });

  it("skips the card checks for a card the plan creates", async () => {
    const db = mockDb();
    const { warnings } = await validateImportPlanPayload(
      USER,
      plan({
        bills: [
          bill({
            creditCardId: undefined,
            newCreditCard: { bankName: "Nubank", lastFourDigits: "1234", closingDay: 5, dueDay: 12, currency: "BRL" },
          }),
        ],
      }),
      asDb(db)
    );

    expect(warnings).toEqual([]);
    expect(db.account.findFirst).not.toHaveBeenCalled();
    expect(db.cardStatement.findFirst).not.toHaveBeenCalled();
  });

  it("warns when the statement of the closing month already has entries", async () => {
    const db = mockDb({ cardStatement: { _count: { entries: 4 } } });

    const { warnings } = await validateImportPlanPayload(USER, plan({ bills: [bill()] }), asDb(db));

    expect(warnings).toEqual(["The 2026-03 statement of this card already has 4 entr(ies) - only rows not already on it will be added."]);
    expect(db.cardStatement.findFirst).toHaveBeenCalledWith({
      where: { accountId: "card-1", month: "2026-03" },
      select: { _count: { select: { entries: { where: { deletedAt: null } } } } },
    });
  });

  it("does not warn about a statement that exists but is empty, nor about a missing one", async () => {
    const empty = mockDb({ cardStatement: { _count: { entries: 0 } } });
    const missing = mockDb({ cardStatement: null });

    expect((await validateImportPlanPayload(USER, plan({ bills: [bill()] }), asDb(empty))).warnings).toEqual([]);
    expect((await validateImportPlanPayload(USER, plan({ bills: [bill()] }), asDb(missing))).warnings).toEqual([]);
  });

  it("pads the month of a closing date in January to two digits", async () => {
    const db = mockDb();
    await validateImportPlanPayload(USER, plan({ bills: [bill({ closingDate: "2026-01-31" })] }), asDb(db));
    expect(db.cardStatement.findFirst.mock.calls[0]![0].where.month).toBe("2026-01");
  });
});

describe("an empty plan", () => {
  it("warns that there is nothing to write", async () => {
    const { warnings } = await validateImportPlanPayload(USER, plan(), asDb(mockDb()));
    expect(warnings).toEqual(["This plan has nothing to write - every row was a plain skip."]);
  });

  it("does not warn once any list has an entry", async () => {
    const db = mockDb({ ledgerFindMany: [{ id: "tx-1" }] });
    const { warnings } = await validateImportPlanPayload(
      USER,
      plan({ reconciliations: [{ existingTransactionId: "tx-1", externalId: "row-out", updates: { amount: 1 } }] }),
      asDb(db)
    );
    expect(warnings).not.toContain("This plan has nothing to write - every row was a plain skip.");
  });
});
