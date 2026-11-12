import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { createEntry, softDeleteEntries } from "@capital/server/modules/ledger/services/entries";
import { validateImportPlanPayload } from "../validate-import-plan-payload";
import { ImportPlanPayloadSchema } from "../../tools/schemas/import-plan-payload";

/**
 * validateImportPlanPayload against real rows: the queries behind each
 * ownership and staleness guard must find (or miss) what the guards assume,
 * including another user's rows and rows in the trash. User B only exists
 * to own the rows A must not be able to reach.
 */

const A = "test-user-assistant-validate-001";
const B = "test-user-assistant-validate-002";

const ROWS = [
  { fitId: "row-out", date: "2026-01-10", description: "Pix enviado", fullDescription: "Pix enviado", amount: -1000, type: "expense" as const },
  { fitId: "row-in", date: "2026-01-11", description: "Pix recebido", fullDescription: "Pix recebido", amount: 500, type: "income" as const },
];

let a: LedgerFixture;
let b: LedgerFixture;
let fileA: string;
let fileB: string;
let billFileA: string;
let holdingA: string;
let holdingB: string;
let operationExternalId: string;
let entryUnlinked: string;
let entryLinked: string;
let entryTrashed: string;
let entryOfB: string;
let transferA: string;
let transferB: string;
let transferTrashed: string;
let cardMonthWithEntries: string;

function plan(overrides: Record<string, unknown> = {}) {
  return ImportPlanPayloadSchema.parse({
    entityType: "business",
    entityId: a.pjId,
    fileId: fileA,
    currency: "BRL",
    ...overrides,
  });
}

const validate = (payload: ReturnType<typeof plan>) => validateImportPlanPayload(A, payload, prisma);

const expenseRow = (overrides: Record<string, unknown> = {}) => ({
  externalId: "row-out",
  date: "2026-01-10",
  description: "Pix enviado",
  amount: 1000,
  type: "expense",
  ...overrides,
});

const bill = (overrides: Record<string, unknown> = {}) => ({
  fileId: billFileA,
  creditCardId: a.card,
  closingDate: `${cardMonthWithEntries}-05`,
  dueDate: `${cardMonthWithEntries}-12`,
  previewTotalAmount: 100,
  previewTransactionCount: 2,
  ...overrides,
});

async function conversationFile(userId: string, parsedPayload: object | null) {
  const conversation = await prisma.agentConversation.create({ data: { userId, title: "validate" }, select: { id: true } });
  const file = await prisma.conversationFile.create({
    data: {
      conversationId: conversation.id,
      userId,
      fileType: "ofx",
      statementKind: "bank_ofx",
      blobUrl: "blob://x",
      pathname: "x.ofx",
      mimeType: "application/x-ofx",
      sizeBytes: 10,
      originalName: "extrato.ofx",
      parseStatus: parsedPayload ? "parsed" : "pending",
      parsedPayload: parsedPayload ?? undefined,
    },
    select: { id: true },
  });
  return file.id;
}

beforeAll(async () => {
  a = await createLedgerFixture(prisma, A);
  b = await createLedgerFixture(prisma, B);

  fileA = await conversationFile(A, { kind: "bank_ofx", rows: ROWS });
  fileB = await conversationFile(B, { kind: "bank_ofx", rows: ROWS });
  billFileA = await conversationFile(A, null);

  // Entries of the business entity: one already imported, one waiting to be
  // linked, one that is linked to another row, one in the trash.
  const imported = await createEntry(A, { kind: "expense", accountId: a.pjChecking, amount: 10, description: "Importado", date: "2026-01-02", externalId: "existing-fit" }, prisma);
  expect(imported.entryIds).toHaveLength(1);
  entryUnlinked = (await createEntry(A, { kind: "expense", accountId: a.pjChecking, amount: 20, description: "Sem vínculo", date: "2026-01-03" }, prisma)).entryIds[0]!;
  entryLinked = (await createEntry(A, { kind: "expense", accountId: a.pjChecking, amount: 30, description: "Vinculado", date: "2026-01-04", externalId: "other-fit" }, prisma)).entryIds[0]!;
  entryTrashed = (await createEntry(A, { kind: "expense", accountId: a.pjChecking, amount: 40, description: "Lixeira", date: "2026-01-05", externalId: "trashed-fit" }, prisma)).entryIds[0]!;
  await softDeleteEntries(A, [entryTrashed], prisma);
  // The same externalId on the personal entity does not collide with the business one.
  await createEntry(A, { kind: "expense", accountId: a.pfChecking, amount: 50, description: "Na PF", date: "2026-01-06", externalId: "pf-fit" }, prisma);
  entryOfB = (await createEntry(B, { kind: "expense", accountId: b.pjChecking, amount: 60, description: "De outro usuário", date: "2026-01-07" }, prisma)).entryIds[0]!;

  const own = await createEntry(A, { kind: "transfer", fromAccountId: a.pjChecking, toAccountId: a.pfChecking, amount: 70, date: "2026-01-08" }, prisma);
  transferA = own.transferGroupId!;
  transferB = (await createEntry(B, { kind: "transfer", fromAccountId: b.pjChecking, toAccountId: b.pfChecking, amount: 80, date: "2026-01-08" }, prisma)).transferGroupId!;
  const trashed = await createEntry(A, { kind: "transfer", fromAccountId: a.pjChecking, toAccountId: a.pfChecking, amount: 90, date: "2026-01-09" }, prisma);
  transferTrashed = trashed.transferGroupId!;
  await softDeleteEntries(A, trashed.entryIds, prisma);

  // Card statement with two live entries and one in the trash.
  const live = await createEntry(A, { kind: "expense", accountId: a.card, amount: 100, description: "Compra 1", date: "2026-09-03" }, prisma);
  await createEntry(A, { kind: "expense", accountId: a.card, amount: 110, description: "Compra 2", date: "2026-09-03" }, prisma);
  const gone = await createEntry(A, { kind: "expense", accountId: a.card, amount: 120, description: "Compra 3", date: "2026-09-03" }, prisma);
  await softDeleteEntries(A, gone.entryIds, prisma);
  const statement = await prisma.ledgerEntry.findFirstOrThrow({ where: { id: live.entryIds[0] }, select: { cardStatement: { select: { month: true } } } });
  cardMonthWithEntries = statement.cardStatement!.month;

  holdingA = (await prisma.investmentHolding.create({ data: { accountId: a.broker, assetClass: "stocks", ticker: "PETR4", name: "Petrobras" } })).id;
  holdingB = (await prisma.investmentHolding.create({ data: { accountId: b.broker, assetClass: "stocks", ticker: "VALE3", name: "Vale" } })).id;
  operationExternalId = "inv-op-existing";
  await prisma.investmentOperation.create({
    data: { holdingId: holdingA, type: "buy", quantity: 1, pricePerUnit: 10, totalAmount: 10, date: new Date("2026-01-12"), externalId: operationExternalId },
  });
});

afterAll(async () => {
  // Cascades the accounts, entries, holdings, conversations and files.
  await deleteLedgerFixture(prisma, A);
  await deleteLedgerFixture(prisma, B);
});

describe("a plan that is consistent with the database", () => {
  it("passes with no warnings", async () => {
    const result = await validate(
      plan({
        transactions: [expenseRow()],
        transfers: [
          {
            externalId: "row-in",
            date: "2026-01-11",
            amount: 500,
            flow: "inflow",
            direction: "capital_injection",
            counterpartyEntityType: "personal",
            counterpartyEntityId: a.pfId,
          },
        ],
      })
    );
    expect(result).toEqual({ warnings: [] });
  });

  it("warns that a plan with nothing in it writes nothing", async () => {
    expect(await validate(plan())).toEqual({ warnings: ["This plan has nothing to write - every row was a plain skip."] });
  });
});

describe("entity and file ownership", () => {
  it("rejects an entity of another user", async () => {
    await expect(validate(plan({ entityId: b.pjId }))).rejects.toThrow(`business entity ${b.pjId} not found or access denied`);
  });

  it("rejects an entity id of the wrong kind", async () => {
    await expect(validate(plan({ entityType: "personal", entityId: a.pjId }))).rejects.toThrow(
      `personal entity ${a.pjId} not found or access denied`
    );
  });

  it("rejects a file of another user", async () => {
    await expect(validate(plan({ fileId: fileB }))).rejects.toThrow(`File ${fileB} not found or access denied`);
  });

  it("rejects a plan without a file", async () => {
    await expect(validate(plan({ fileId: undefined }))).rejects.toThrow("fileId is required");
  });
});

describe("stale externalIds", () => {
  it("rejects a transaction that is already in the ledger for the entity", async () => {
    await expect(validate(plan({ transactions: [expenseRow({ externalId: "existing-fit" })] }))).rejects.toThrow(
      "1 transaction(s) with these externalIds already exist for this entity"
    );
  });

  it("does not count a row in the trash, nor one on another entity", async () => {
    const { warnings } = await validate(
      plan({ transactions: [expenseRow({ externalId: "trashed-fit" }), expenseRow({ externalId: "pf-fit" })] })
    );
    // Neither is a row of the file, so they are only taken on trust.
    expect(warnings).toEqual([
      "2 row(s) could not be checked against the file's parsed rows (trashed-fit, pf-fit) - their amount and direction are taken on trust.",
    ]);
  });
});

describe("link_fuzzy targets", () => {
  const link = (existingTransactionId: string) => ({ externalId: "row-out", resolution: "link_fuzzy", existingTransactionId });

  it("accepts an unlinked entry of the user", async () => {
    const { warnings } = await validate(plan({ duplicateDecisions: [link(entryUnlinked)] }));
    expect(warnings).toEqual(["This plan has nothing to write - every row was a plain skip."]);
  });

  it("rejects an entry that already has an externalId", async () => {
    await expect(validate(plan({ duplicateDecisions: [link(entryLinked)] }))).rejects.toThrow("already has an externalId");
  });

  it("rejects an entry of another user and one in the trash", async () => {
    await expect(validate(plan({ duplicateDecisions: [link(entryOfB)] }))).rejects.toThrow(
      `link_fuzzy target transaction ${entryOfB} not found or access denied`
    );
    await expect(validate(plan({ duplicateDecisions: [link(entryTrashed)] }))).rejects.toThrow(
      `link_fuzzy target transaction ${entryTrashed} not found or access denied`
    );
  });
});

describe("transfer counterparties", () => {
  it("rejects a counterparty entity of another user", async () => {
    await expect(
      validate(
        plan({
          transfers: [
            {
              externalId: "row-in",
              date: "2026-01-11",
              amount: 500,
              flow: "inflow",
              direction: "capital_injection",
              counterpartyEntityType: "personal",
              counterpartyEntityId: b.pfId,
            },
          ],
        })
      )
    ).rejects.toThrow(`Transfer counterparty personal ${b.pfId} not found or access denied`);
  });
});

describe("investment accounts and holdings", () => {
  const deposit = (investmentAccountId: string) => ({
    externalId: "row-out",
    date: "2026-01-10",
    amount: 1000,
    direction: "investment_deposit",
    investmentAccountId,
  });
  const buy = (overrides: Record<string, unknown> = {}) => ({
    externalId: "inv-op-new",
    accountId: a.broker,
    holdingId: holdingA,
    type: "buy",
    quantity: 5,
    pricePerUnit: 10,
    totalAmount: 50,
    date: "2026-01-12",
    ...overrides,
  });

  it("accepts a deposit into a brokerage of the user", async () => {
    expect(await validate(plan({ investmentTransfers: [deposit(a.broker)] }))).toEqual({ warnings: [] });
  });

  it("rejects a brokerage of another user", async () => {
    await expect(validate(plan({ investmentTransfers: [deposit(b.broker)] }))).rejects.toThrow(
      `Investment account ${b.broker} not found or access denied`
    );
  });

  it("rejects an account of the user that is not a brokerage", async () => {
    await expect(validate(plan({ investmentTransfers: [deposit(a.pjChecking)] }))).rejects.toThrow(
      `Investment account ${a.pjChecking} not found or access denied`
    );
  });

  it("accepts a new operation on an owned holding", async () => {
    expect(await validate(plan({ investmentTransactions: [buy()] }))).toEqual({ warnings: [] });
  });

  it("rejects a holding of another user", async () => {
    await expect(validate(plan({ investmentTransactions: [buy({ holdingId: holdingB })] }))).rejects.toThrow(
      `Investment holding ${holdingB} not found or access denied`
    );
  });

  it("rejects an operation already recorded on the holding, but not the same id on a new holding", async () => {
    await expect(validate(plan({ investmentTransactions: [buy({ externalId: operationExternalId })] }))).rejects.toThrow(
      "1 investment transaction(s) with these externalIds already exist for their holding"
    );
    expect(
      await validate(
        plan({
          investmentTransactions: [
            buy({
              externalId: operationExternalId,
              holdingId: undefined,
              newHolding: { assetClass: "stocks", ticker: "ITUB4", name: "Itaú", currency: "BRL" },
            }),
          ],
        })
      )
    ).toEqual({ warnings: [] });
  });

  it("rejects an operation with neither a holding nor a new one", async () => {
    await expect(validate(plan({ investmentTransactions: [buy({ holdingId: undefined })] }))).rejects.toThrow(
      "has neither holdingId nor newHolding"
    );
  });
});

describe("reconciliation targets", () => {
  const reconcile = (existingTransactionId: string) => ({
    existingTransactionId,
    externalId: "row-out",
    updates: { amount: 20 },
  });
  const reconcileTransfer = (existingTransferId: string) => ({
    existingTransferId,
    externalId: "row-out",
    updates: { amount: 70 },
  });

  it("accepts an entry of the user", async () => {
    expect(await validate(plan({ reconciliations: [reconcile(entryUnlinked)] }))).toEqual({ warnings: [] });
  });

  it("rejects an entry of another user and one in the trash", async () => {
    await expect(validate(plan({ reconciliations: [reconcile(entryOfB)] }))).rejects.toThrow(
      `Reconciliation target transaction ${entryOfB} not found or access denied`
    );
    await expect(validate(plan({ reconciliations: [reconcile(entryUnlinked), reconcile(entryTrashed)] }))).rejects.toThrow(
      `Reconciliation target transaction ${entryTrashed} not found or access denied`
    );
  });

  it("accepts a transfer of the user", async () => {
    expect(await validate(plan({ transferReconciliations: [reconcileTransfer(transferA)] }))).toEqual({ warnings: [] });
  });

  it("rejects a transfer of another user and one in the trash", async () => {
    await expect(validate(plan({ transferReconciliations: [reconcileTransfer(transferB)] }))).rejects.toThrow(
      `Transfer reconciliation target ${transferB} not found or access denied`
    );
    await expect(validate(plan({ transferReconciliations: [reconcileTransfer(transferTrashed)] }))).rejects.toThrow(
      `Transfer reconciliation target ${transferTrashed} not found or access denied`
    );
  });
});

describe("bills", () => {
  it("warns with the count of live entries when the statement of the month already has some", async () => {
    // Two live entries; the one in the trash is not counted.
    expect(await validate(plan({ bills: [bill()] }))).toEqual({
      warnings: [`The ${cardMonthWithEntries} statement of this card already has 2 entr(ies) - only rows not already on it will be added.`],
    });
  });

  it("does not warn for a month the card has no statement for", async () => {
    expect(await validate(plan({ bills: [bill({ closingDate: "2031-02-05", dueDate: "2031-02-12" })] }))).toEqual({ warnings: [] });
  });

  it("rejects a card of another user and an account that is not a card", async () => {
    await expect(validate(plan({ bills: [bill({ creditCardId: b.card })] }))).rejects.toThrow(
      `Credit card ${b.card} not found or access denied`
    );
    await expect(validate(plan({ bills: [bill({ creditCardId: a.pfChecking })] }))).rejects.toThrow(
      `Credit card ${a.pfChecking} not found or access denied`
    );
  });

  it("rejects a bill whose file belongs to another user", async () => {
    await expect(validate(plan({ bills: [bill({ fileId: fileB })] }))).rejects.toThrow(`File ${fileB} not found or access denied`);
  });

  it("accepts a bill that creates its card without looking at statements", async () => {
    expect(
      await validate(
        plan({
          bills: [
            bill({
              creditCardId: undefined,
              newCreditCard: { bankName: "Inter", lastFourDigits: "9999", closingDay: 10, dueDay: 17, currency: "BRL" },
            }),
          ],
        })
      )
    ).toEqual({ warnings: [] });
  });
});
