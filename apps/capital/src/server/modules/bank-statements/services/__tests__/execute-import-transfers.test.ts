import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import type { ImportPlanPayload } from "@capital/server/modules/assistant/agent/tools/schemas/import-plan-payload";
import { toNumber } from "@capital/server/modules/ledger/lib/money";
import { createEntry } from "@capital/server/modules/ledger/services/entries";
import { executeImport } from "../execute-import";
import { executeRevert } from "../execute-revert";

/**
 * executeImport: who the plan may write to (entity, target account, account
 * kind), transfers between entities, investment transfers, card payments
 * and the reconciliation of rows the ledger already has.
 */

const USER = "test-user-exec-import-xfer-a";
let f: LedgerFixture;
let other: LedgerFixture;

beforeEach(async () => {
  f = await createLedgerFixture(prisma, USER);
  other = await createLedgerFixture(prisma, `${USER}-other`);
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
  await deleteLedgerFixture(prisma, `${USER}-other`);
});

const plan = (over: Partial<ImportPlanPayload> = {}): ImportPlanPayload => ({
  entityType: "personal",
  entityId: f.pfId,
  currency: "BRL",
  transactions: [],
  transfers: [],
  investmentTransfers: [],
  creditCards: [],
  bills: [],
  reconciliations: [],
  transferReconciliations: [],
  duplicateDecisions: [],
  investmentTransactions: [],
  ...over,
});

const run = (p: ImportPlanPayload) => executeImport(USER, p, prisma);
const transfer = (over: Partial<ImportPlanPayload["transfers"][number]> = {}): ImportPlanPayload["transfers"][number] => ({
  externalId: "tr-1",
  date: "2026-09-04",
  amount: 300,
  description: "Pró-labore",
  flow: "inflow",
  direction: "profit_distribution",
  counterpartyEntityType: "business",
  counterpartyEntityId: f.pjId,
  ...over,
});
const legs = (groupId: string) => prisma.ledgerEntry.findMany({ where: { transferGroupId: groupId }, orderBy: { amount: "asc" } });

describe("executeImport: where the plan writes", () => {
  it("answers 404 for an entity that is not the user's, or not of the kind the plan says", async () => {
    await expect(run(plan({ entityId: other.pfId }))).rejects.toMatchObject({ status: 404, code: "entity.not_found", message: "Personal account not found or access denied" });
    await expect(run(plan({ entityId: f.pfId, entityType: "business" }))).rejects.toMatchObject({ status: 404, code: "entity.not_found", message: "Business not found or access denied" });
    expect(await prisma.import.count({ where: { userId: USER } })).toBe(0);
  });

  it("refuses an unknown, archived, other-entity or brokerage target account", async () => {
    await expect(run(plan({ accountId: "nao-existe" }))).rejects.toMatchObject({ status: 404, code: "account.not_found" });
    await expect(run(plan({ accountId: other.pfChecking }))).rejects.toMatchObject({ status: 404, code: "account.not_found" });
    const archived = await prisma.account.create({ data: { userId: USER, entityId: f.pfId, type: "checking", name: "Antiga", currency: "BRL", archivedAt: new Date() } });
    await expect(run(plan({ accountId: archived.id }))).rejects.toMatchObject({ status: 422, code: "account.archived", params: { name: "Antiga" } });
    await expect(run(plan({ accountId: f.pjChecking }))).rejects.toMatchObject({ status: 422, code: "import.account_entity_mismatch" });
    await expect(run(plan({ accountId: f.broker }))).rejects.toMatchObject({ status: 422, code: "import.account_kind_mismatch", params: { name: "XP" } });
  });

  it("imports into the entity's main account by default, and into a cash account when it is named", async () => {
    const cash = await prisma.account.create({ data: { userId: USER, entityId: f.pfId, type: "cash", name: "Carteira", currency: "BRL" } });
    const t = { externalId: "c1", date: "2026-09-02", description: "Pao", amount: 5, type: "expense" as const };
    const main = await run(plan({ transactions: [t] }));
    const wallet = await run(plan({ accountId: cash.id, transactions: [{ ...t, externalId: "c2" }] }));
    expect([main.accountId, main.accountName]).toEqual([f.pfChecking, "Conta principal"]);
    expect([wallet.accountId, wallet.accountName]).toEqual([cash.id, "Carteira"]);
  });

  it("keeps bank-only items out of a card import, and a card statement out of a bank import", async () => {
    const mismatch = { status: 422, code: "import.account_kind_mismatch", params: { name: "Nubank" } };
    const reconciliation = { existingTransactionId: "x", externalId: "e", updates: { amount: 1 } };
    const cardOnly = { accountId: f.card };
    await expect(run(plan({ ...cardOnly, transfers: [transfer()] }))).rejects.toMatchObject(mismatch);
    await expect(run(plan({ ...cardOnly, investmentTransfers: [{ externalId: "i", date: "2026-09-01", amount: 1, direction: "investment_deposit", investmentAccountId: f.broker }] }))).rejects.toMatchObject(mismatch);
    await expect(run(plan({ ...cardOnly, transferReconciliations: [{ existingTransferId: "x", externalId: "e", updates: {} }] }))).rejects.toMatchObject(mismatch);
    await expect(run(plan({ ...cardOnly, cardPayments: [{ externalId: "p", date: "2026-09-11", amount: 1, cardAccountId: f.card }] }))).rejects.toMatchObject(mismatch);
    await expect(run(plan({ ...cardOnly, reconciliations: [reconciliation] }))).rejects.toMatchObject(mismatch);
    await expect(run(plan({ cardStatement: { month: "2026-09", rows: [] } }))).rejects.toMatchObject({ status: 422, code: "import.account_kind_mismatch", params: { name: "Conta principal" } });
    // A card plan may carry reconciliations (rows of its bill that changed): they need the bill.
    await expect(run(plan({ ...cardOnly, cardStatement: { month: "2026-09", rows: [] }, reconciliations: [reconciliation] }))).rejects.toMatchObject({ code: "entry.not_found" });
  });

  it("starts the imports of the assistant from its conversation and plan", async () => {
    const conversation = await prisma.agentConversation.create({ data: { userId: USER, title: "Importar" } });
    const importPlan = await prisma.importPlan.create({ data: { conversationId: conversation.id, userId: USER, payload: {}, payloadHash: "h", summary: {} } });
    const r = await executeImport(USER, plan(), prisma, { source: "agent", conversationId: conversation.id, importPlanId: importPlan.id });
    expect(await prisma.import.findUniqueOrThrow({ where: { id: r.importId } })).toMatchObject({ source: "agent", conversationId: conversation.id, importPlanId: importPlan.id });
  });
});

describe("executeImport: transfers between entities", () => {
  it("books an outflow of the imported entity from its account to the counterparty's main account", async () => {
    const r = await run(plan({ transfers: [transfer({ externalId: "tr-out", flow: "outflow", direction: "capital_injection", counterpartyEntityId: f.pjId, amount: 700 })] }));
    expect(r).toMatchObject({ transfersCreated: 1, imported: 0, rowsImported: 1 });
    const group = await prisma.transferGroup.findFirstOrThrow({ where: { userId: USER, externalId: "tr-out" } });
    expect(group.direction).toBe("capital_injection");
    expect((await legs(group.id)).map((l) => [l.accountId, toNumber(l.amount), l.importId])).toEqual([
      [f.pfChecking, -700, r.importId],
      [f.pjChecking, 700, r.importId],
    ]);
    expect(r.createdRecords).toEqual(expect.arrayContaining([{ model: "TransferGroup", id: group.id }]));
  });

  it("skips a transfer whose external id is already booked, so the same plan twice books it once", async () => {
    const p = plan({ transfers: [transfer()] });
    expect((await run(p)).transfersCreated).toBe(1);
    expect((await run(p)).transfersCreated).toBe(0);
    expect(await prisma.transferGroup.count({ where: { userId: USER, externalId: "tr-1" } })).toBe(1);
  });

  it("refuses a direction that contradicts who pays whom (422 import.transfer_inconsistent), naming the flow", async () => {
    await expect(run(plan({ transfers: [transfer({ flow: "outflow", direction: "profit_distribution" })] }))).rejects.toMatchObject({
      status: 422,
      code: "import.transfer_inconsistent",
      params: { externalId: "tr-1" },
      message: expect.stringContaining("The statement row is an outflow"),
    });
    await expect(run(plan({ transfers: [transfer({ flow: "inflow", direction: "capital_injection" })] }))).rejects.toMatchObject({
      code: "import.transfer_inconsistent",
      message: expect.stringContaining("The statement row is an inflow"),
    });
    expect(await prisma.transferGroup.count({ where: { userId: USER } })).toBe(0);
  });

  it("answers 404 when the counterparty entity is not the user's", async () => {
    await expect(run(plan({ transfers: [transfer({ counterpartyEntityId: other.pjId })] }))).rejects.toMatchObject({ status: 404, code: "import.transfer_entity_not_owned", params: { externalId: "tr-1" } });
  });
});

describe("executeImport: investment transfers", () => {
  const it1 = (over: Partial<ImportPlanPayload["investmentTransfers"][number]> = {}): ImportPlanPayload["investmentTransfers"][number] => ({
    externalId: "inv-1",
    date: "2026-09-05",
    amount: 1000,
    description: "Aplicação XP",
    direction: "investment_deposit",
    investmentAccountId: f.broker,
    ...over,
  });

  it("books a deposit from the checking to the broker and a withdrawal the other way", async () => {
    const r = await run(plan({ investmentTransfers: [it1(), it1({ externalId: "inv-2", direction: "investment_withdrawal", amount: 250, description: "Resgate XP" })] }));
    expect(r).toMatchObject({ investmentTransfersCreated: 2, rowsImported: 2 });
    const deposit = await prisma.transferGroup.findFirstOrThrow({ where: { userId: USER, externalId: "inv-1" } });
    const withdrawal = await prisma.transferGroup.findFirstOrThrow({ where: { userId: USER, externalId: "inv-2" } });
    expect([deposit.direction, withdrawal.direction]).toEqual(["investment_deposit", "investment_withdrawal"]);
    expect((await legs(deposit.id)).map((l) => [l.accountId, toNumber(l.amount)])).toEqual([[f.pfChecking, -1000], [f.broker, 1000]]);
    expect((await legs(withdrawal.id)).map((l) => [l.accountId, toNumber(l.amount)])).toEqual([[f.broker, -250], [f.pfChecking, 250]]);
  });

  it("skips one already booked, and answers 404 for an account that is no brokerage of the user", async () => {
    await run(plan({ investmentTransfers: [it1()] }));
    expect((await run(plan({ investmentTransfers: [it1()] })).then((x) => x.investmentTransfersCreated))).toBe(0);
    await expect(run(plan({ investmentTransfers: [it1({ externalId: "inv-3", investmentAccountId: f.pfChecking })] }))).rejects.toMatchObject({
      status: 404,
      code: "import.investment_account_not_found",
      params: { accountId: f.pfChecking },
    });
    await expect(run(plan({ investmentTransfers: [it1({ externalId: "inv-4", investmentAccountId: other.broker })] }))).rejects.toMatchObject({ code: "import.investment_account_not_found" });
  });
});

describe("executeImport: card payments from a bank statement", () => {
  const payment = (over: Partial<NonNullable<ImportPlanPayload["cardPayments"]>[number]> = {}) => ({ externalId: "pay-1", date: "2026-09-11", amount: 289.2, cardAccountId: f.card, ...over });

  it("books the row as the card payment transfer of the statement, with the locale's default description, and books it once", async () => {
    const r = await run(plan({ cardPayments: [payment()] }));
    expect(r).toMatchObject({ cardPaymentsCreated: 1, imported: 1, rowsImported: 1 });
    const group = await prisma.transferGroup.findFirstOrThrow({ where: { userId: USER, externalId: "pay-1" } });
    expect(group.direction).toBe("card_payment");
    expect((await prisma.cardStatement.findFirstOrThrow({ where: { accountId: f.card, month: "2026-09" } })).paymentGroupId).toBe(group.id);
    expect((await legs(group.id))[0].description).toBe("Pagamento de fatura");
    // The same plan again: the row is already in the ledger.
    expect(await run(plan({ cardPayments: [payment()] }))).toMatchObject({ cardPaymentsCreated: 0, imported: 0 });
  });

  it("answers 422 when the target of a payment is no credit card of the user", async () => {
    await expect(run(plan({ cardPayments: [payment({ cardAccountId: f.pfChecking })] }))).rejects.toMatchObject({ status: 422, code: "import.card_payment_target", params: { externalId: "pay-1" } });
    await expect(run(plan({ cardPayments: [payment({ cardAccountId: other.card })] }))).rejects.toMatchObject({ code: "import.card_payment_target" });
  });
});

describe("executeImport: rows the ledger already has (reconciliations)", () => {
  it("updates the amount, date and description the plan gives, counting only the entries it changes", async () => {
    const a = (await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 50, description: "Padaria", date: "2026-09-03" }, prisma)).entryIds[0];
    const b = (await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 20, description: "Uber", date: "2026-09-04" }, prisma)).entryIds[0];
    const c = (await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 9, description: "Cafe", date: "2026-09-05" }, prisma)).entryIds[0];
    const r = await run(
      plan({
        reconciliations: [
          { existingTransactionId: a, externalId: "fa", updates: { amount: 55.5, date: "2026-09-04", description: "Padaria Real" } },
          { existingTransactionId: b, externalId: "fb", updates: { description: "Uber *Trip" } },
          { existingTransactionId: c, externalId: "fc", updates: {} },
        ],
      })
    );
    expect(r.reconciled).toBe(2);
    const after = await prisma.ledgerEntry.findMany({ where: { id: { in: [a, b, c] } } });
    const byId = Object.fromEntries(after.map((e) => [e.id, e]));
    expect([toNumber(byId[a].amount), byId[a].description, byId[a].date.toISOString().slice(0, 10)]).toEqual([-55.5, "Padaria Real", "2026-09-04"]);
    expect([toNumber(byId[b].amount), byId[b].description]).toEqual([-20, "Uber *Trip"]);
    expect([toNumber(byId[c].amount), byId[c].description]).toEqual([-9, "Cafe"]);
  });

  describe("of transfers", () => {
    async function seedTransfer(from: string, to: string, direction: "profit_distribution" | "capital_injection" | "investment_deposit" | "investment_withdrawal") {
      const r = await createEntry(USER, { kind: "transfer", fromAccountId: from, toAccountId: to, amount: 500, description: "Transferência", date: "2026-09-04", direction }, prisma);
      return r.transferGroupId!;
    }
    const reconcile = (existingTransferId: string, updates: ImportPlanPayload["transferReconciliations"][number]["updates"]) =>
      run(plan({ transferReconciliations: [{ existingTransferId, externalId: "fit-t", updates }] }));

    it("answers 404 for a transfer that is not the user's", async () => {
      await expect(reconcile("nao-existe", { amount: 1 })).rejects.toMatchObject({ status: 404, code: "import.reconcile_target_not_found", params: { transferId: "nao-existe" } });
      const foreign = (await createEntry(`${USER}-other`, { kind: "transfer", fromAccountId: other.pjChecking, toAccountId: other.pfChecking, amount: 5, description: "x", date: "2026-09-04", direction: "profit_distribution" }, prisma)).transferGroupId!;
      await expect(reconcile(foreign, { amount: 1 })).rejects.toMatchObject({ code: "import.reconcile_target_not_found" });
    });

    it("updates the amount and date of a transfer through its paying leg, and counts it", async () => {
      const group = await seedTransfer(f.pjChecking, f.pfChecking, "profit_distribution");
      const r = await reconcile(group, { amount: 650, date: "2026-09-06", description: "Pró-labore setembro" });
      expect(r.transferReconciled).toBe(1);
      expect((await legs(group)).map((l) => [toNumber(l.amount), l.date.toISOString().slice(0, 10)])).toEqual([
        [-650, "2026-09-06"],
        [650, "2026-09-06"],
      ]);
      expect((await legs(group))[0].description).toBe("Pró-labore setembro");
    });

    it("counts nothing when the update is empty", async () => {
      const group = await seedTransfer(f.pjChecking, f.pfChecking, "profit_distribution");
      expect((await reconcile(group, {})).transferReconciled).toBe(0);
    });

    it("relabels a business-to-personal transfer as a reimbursement (its legs become expenses) and the revert puts it back", async () => {
      const group = await seedTransfer(f.pjChecking, f.pfChecking, "profit_distribution");
      const r = await reconcile(group, { direction: "reimbursement" });
      expect(r.transferReconciled).toBe(1);
      expect((await prisma.transferGroup.findUniqueOrThrow({ where: { id: group } })).direction).toBe("reimbursement");
      expect((await legs(group)).map((l) => l.kind)).toEqual(["expense", "expense"]);

      await executeRevert(USER, { statementImportId: r.importId, createdRecords: [] }, prisma);
      expect((await prisma.transferGroup.findUniqueOrThrow({ where: { id: group } })).direction).toBe("profit_distribution");
      expect((await legs(group)).map((l) => l.kind)).toEqual(["transfer", "transfer"]);
    });

    it("accepts the relabels that keep the sides the transfer already has, in every family", async () => {
      const injection = await seedTransfer(f.pfChecking, f.pjChecking, "capital_injection");
      expect((await reconcile(injection, { direction: "capital_injection" })).transferReconciled).toBe(1);
      const deposit = await seedTransfer(f.pfChecking, f.broker, "investment_deposit");
      expect((await reconcile(deposit, { direction: "investment_deposit" })).transferReconciled).toBe(1);
      const withdrawal = await seedTransfer(f.broker, f.pfChecking, "investment_withdrawal");
      expect((await reconcile(withdrawal, { direction: "investment_withdrawal" })).transferReconciled).toBe(1);
    });

    it("refuses a relabel that would need other sides (422 import.reconcile_direction_change), changing nothing", async () => {
      const profit = await seedTransfer(f.pjChecking, f.pfChecking, "profit_distribution");
      const injection = await seedTransfer(f.pfChecking, f.pjChecking, "capital_injection");
      const deposit = await seedTransfer(f.pfChecking, f.broker, "investment_deposit");
      const withdrawal = await seedTransfer(f.broker, f.pfChecking, "investment_withdrawal");
      const refused = (group: string, direction: NonNullable<ImportPlanPayload["transferReconciliations"][number]["updates"]["direction"]>) =>
        expect(reconcile(group, { direction, amount: 1 })).rejects.toMatchObject({ status: 422, code: "import.reconcile_direction_change", params: { transferId: group, direction } });
      await refused(profit, "capital_injection");
      await refused(injection, "profit_distribution");
      await refused(injection, "reimbursement");
      await refused(deposit, "investment_withdrawal");
      await refused(withdrawal, "investment_deposit");
      await refused(profit, "investment_deposit");
      expect((await prisma.transferGroup.findUniqueOrThrow({ where: { id: profit } })).direction).toBe("profit_distribution");
      expect(toNumber((await legs(profit))[0].amount)).toBe(-500);
    });
  });
});
