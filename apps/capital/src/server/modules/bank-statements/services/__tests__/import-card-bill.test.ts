import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { toNumber } from "@capital/server/modules/ledger/lib/money";
import { importCardBill } from "../import-card-bill";

const USER = "test-user-import-card-bill-a";
let f: LedgerFixture;

beforeEach(async () => {
  f = await createLedgerFixture(prisma, USER);
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

const bill = (accountId: string, content: string, extra: { fileName?: string } = {}) => importCardBill(USER, { accountId, closingDate: "2026-09-05", dueDate: "2026-09-12", content, ...extra }, prisma);

const CSV = [
  "date,title,amount",
  "2026-08-10,Mercado,120.00",
  "2026-08-11,Brinde,0.00",
  "2026-08-12,Notebook - Parcela 1/3,300.00",
  "2026-08-13,Loja unica (1/1),40.00",
  "2026-08-15,Estorno Amazon,-20.00",
  "2026-08-14,Pagamento recebido,-1000.00",
].join("\n");

describe("importCardBill", () => {
  it("books the file on the statement of its closing month as a real import of the card, without payment lines or zero rows", async () => {
    const r = await bill(f.card, CSV, { fileName: "fatura-setembro.csv" });
    expect(r).toMatchObject({ month: "2026-09", created: 4, skipped: 0, transactionCount: 4 });

    const imp = await prisma.import.findUniqueOrThrow({ where: { id: r.importId } });
    expect(imp).toMatchObject({ accountId: f.card, entityId: f.pfId, fileName: "fatura-setembro.csv", source: "manual", ledgerCurrency: "BRL" });
    const batch = await prisma.mutationBatch.findUniqueOrThrow({ where: { id: r.batchId } });
    expect(batch).toMatchObject({ op: "import", source: "import" });

    const rows = await prisma.ledgerEntry.findMany({ where: { userId: USER, importId: r.importId, cardStatementId: r.statementId! }, orderBy: { description: "asc" } });
    expect(rows.map((e) => [e.description, toNumber(e.amount), e.installmentNumber])).toEqual([
      ["Estorno Amazon", 20, null],
      ["Loja unica (1/1)", -40, null],
      ["Mercado", -120, null],
      ["Notebook", -300, 1],
    ]);
    // A "1/1" suffix is no installment (the description keeps it); the three-part one is a plan, with its later parcels projected.
    expect(await prisma.installmentPlan.count({ where: { accountId: f.card } })).toBe(1);
    expect(await prisma.ledgerEntry.count({ where: { userId: USER, installmentNumber: { in: [2, 3] }, deletedAt: null } })).toBe(2);
    const statement = await prisma.cardStatement.findUniqueOrThrow({ where: { id: r.statementId! } });
    expect(toNumber(statement.totalAmount)).toBe(440);
  });

  it("books a business card as an import of that business, with the card's institution as the bank", async () => {
    const card = await prisma.account.create({ data: { userId: USER, entityId: f.pjId, type: "credit_card", name: "Itaú PJ", institution: "Itaú", currency: "BRL", closingDay: 5, dueDay: 12 } });
    const r = await bill(card.id, "date,title,amount\n2026-08-10,Mercado,10.00\n");
    expect(await prisma.import.findUniqueOrThrow({ where: { id: r.importId } })).toMatchObject({ entityId: f.pjId, accountId: card.id, bankName: "Itaú", fileName: null });
  });

  it("re-importing the same file skips every row", async () => {
    await bill(f.card, CSV);
    expect(await bill(f.card, CSV)).toMatchObject({ created: 0, skipped: 4, transactionCount: 4 });
  });

  it("answers 404 for a card of someone else and 422 for an account that is no card", async () => {
    await expect(importCardBill("nobody-else", { accountId: f.card, closingDate: "2026-09-05", dueDate: "2026-09-12", content: CSV }, prisma)).rejects.toMatchObject({ status: 404, code: "account.not_found" });
    await expect(bill(f.pfChecking, CSV)).rejects.toMatchObject({ status: 422, code: "account.not_credit_card" });
    expect(await prisma.import.count({ where: { userId: USER } })).toBe(0);
  });

  it("answers a file it cannot read, or with a date it cannot read, with import.invalid_file and writes nothing", async () => {
    await expect(bill(f.card, "date,title,amount")).rejects.toMatchObject({ status: 400, code: "import.invalid_file" });
    await expect(bill(f.card, "date,title,amount\nontem,Mercado,10.00\n")).rejects.toMatchObject({ status: 400, code: "import.invalid_file", message: "Invalid date format: ontem" });
    expect(await prisma.import.count({ where: { userId: USER } })).toBe(0);
    expect(await prisma.cardStatement.count({ where: { accountId: f.card } })).toBe(0);
  });
});
