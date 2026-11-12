import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { toNumber } from "@capital/server/modules/ledger/lib/money";
import { createEntry } from "@capital/server/modules/ledger/services/entries";
import { undoBatch } from "@capital/server/modules/ledger/services/mutations";
import type { ParsedTransaction } from "../parsers";
import {
  calculateBillTotal,
  dedupeKey,
  excludeProjected,
  importCardFile,
  importCardStatement,
  isProjected,
  parseCardFile,
  shiftMonth,
  statementLedgerRows,
} from "../import-card-statement";

const USER = "test-user-card-stmt-import-a";
let f: LedgerFixture;

beforeEach(async () => {
  f = await createLedgerFixture(prisma, USER);
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

const newImport = () => prisma.import.create({ data: { userId: USER, entityId: f.pfId, accountId: f.card, ledgerCurrency: "BRL", transactionCount: 0 } });

const live = (where: object = {}) => prisma.ledgerEntry.findMany({ where: { userId: USER, deletedAt: null, accountId: f.card, ...where }, orderBy: [{ date: "asc" }, { description: "asc" }] });

describe("pure helpers", () => {
  it("dedupeKey names a purchase by day, amount, collapsed description and installment", () => {
    const day = new Date("2026-09-02T12:00:00Z");
    expect(dedupeKey(day, 64.3, "  DROGASIL   1234 ")).toBe("2026-09-02|64.30|drogasil 1234");
    expect(dedupeKey(day, 64.3, "drogasil 1234", null)).toBe(dedupeKey(day, 64.3, "DROGASIL 1234"));
    expect(dedupeKey(day, 64.3, "Loja", 2)).toBe("2026-09-02|64.30|loja|2");
  });

  it("shiftMonth moves across years in both directions", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-09", 0)).toBe("2026-09");
    expect(shiftMonth("2026-11", 14)).toBe("2028-01");
  });

  it("isProjected is true only for metadata flagged projected", () => {
    expect(isProjected({ projected: true })).toBe(true);
    expect(isProjected({ projected: "true" })).toBe(false);
    expect(isProjected({ totalInstallments: 3 })).toBe(false);
    expect(isProjected(null)).toBe(false);
    expect(isProjected("projected")).toBe(false);
  });
});

describe("calculateBillTotal", () => {
  const closing = new Date("2026-09-05T12:00:00Z");
  const line = (date: string, description: string, amount: number, isPayment = false): ParsedTransaction => ({ date, description, amount, isPayment });

  it("sums the charges and this cycle's refunds, leaving out payments and refunds of an earlier cycle", () => {
    const total = calculateBillTotal(
      [
        line("2026-08-10", "Mercado", 100),
        line("2026-08-20", "Estorno loja", -20),
        line("2026-07-01", "Estorno antigo", -30),
        line("2026-07-02", "Pagamento recebido", -500, true),
      ],
      closing
    );
    // The payment on 2026-07-02 sets the cutoff, so the 07-01 refund (before it) is a previous bill's adjustment.
    expect(total).toBe(80);
  });

  it("without payment lines the cycle starts the day after the previous closing", () => {
    const total = calculateBillTotal([line("2026-08-10", "Mercado", 100), line("2026-08-05", "Estorno do ciclo anterior", -15), line("2026-08-06", "Estorno do ciclo", -5)], closing);
    expect(total).toBe(95);
  });

  it("always counts IOF adjustments, whatever their date", () => {
    const total = calculateBillTotal([line("2026-08-10", "Mercado", 100), line("2026-07-01", "Ajuste a crédito", -4), line("2026-07-01", "IOF de volta", -1)], closing);
    expect(total).toBe(95);
  });

  it("falls back to the cycle start when a payment line has no readable date, and counts a refund whose date it cannot read", () => {
    const total = calculateBillTotal([line("2026-08-10", "Mercado", 100), line("sem data", "Pagamento recebido", -500, true), line("sem data", "Estorno", -10), line("2026-07-01", "Estorno antigo", -50)], closing);
    expect(total).toBe(90);
  });
});

describe("parseCardFile", () => {
  it("reads a CSV, and a card OFX by its CCSTMTRS block", () => {
    expect(parseCardFile("date,title,amount\n2026-09-01,Cafe,9.90\n")).toEqual([
      { date: "2026-09-01", description: "Cafe", amount: 9.9, installmentNumber: undefined, totalInstallments: undefined, isPayment: false },
    ]);
    const ofx = `<OFX><CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS><CURDEF>BRL<CCACCTFROM><ACCTID>1111</CCACCTFROM>
<BANKTRANLIST><STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260901120000<TRNAMT>-9.90<FITID>f1<MEMO>Cafe</STMTTRN></BANKTRANLIST></CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>`;
    expect(parseCardFile(ofx)).toEqual([expect.objectContaining({ date: "2026-09-01", description: "Cafe", amount: 9.9, externalId: "f1", isPayment: false })]);
  });

  it("answers an unreadable CSV with import.invalid_file (400) and a file with no rows with import.no_transactions (422)", () => {
    expect(() => parseCardFile("date,title,amount")).toThrow(expect.objectContaining({ status: 400, code: "import.invalid_file", message: "CSV must have at least a header and one data row" }));
    expect(() => parseCardFile("just\nsome\nnotes")).toThrow(expect.objectContaining({ status: 422, code: "import.no_transactions" }));
    expect(() => parseCardFile("<CCSTMTRS><BANKTRANLIST></BANKTRANLIST></CCSTMTRS>")).toThrow(expect.objectContaining({ status: 422, code: "import.no_transactions" }));
  });
});

describe("importCardFile", () => {
  const CSV = ["date,title,amount", "2026-08-10,Mercado,120.00", "2026-08-12,Notebook - Parcela 1/3,300.00", "2026-08-15,Estorno Amazon,-20.00", "2026-08-14,Pagamento recebido,-1000.00"].join("\n");

  it("books a bill file on the statement of its closing month, with the total and dates, as one import batch", async () => {
    const imp = await newImport();
    const r = await importCardFile(USER, { accountId: f.card, closingDate: "2026-09-05", dueDate: "2026-09-12", content: CSV, importId: imp.id }, prisma);
    expect(r).toMatchObject({ month: "2026-09", created: 3, skipped: 0, transactionCount: 3 });
    expect(r.batchId).toEqual(expect.any(String));

    const statement = await prisma.cardStatement.findUniqueOrThrow({ where: { id: r.statementId } });
    expect(statement.closingDate?.toISOString().slice(0, 10)).toBe("2026-09-05");
    expect(statement.dueDate?.toISOString().slice(0, 10)).toBe("2026-09-12");
    // 120 + 300 - 20: the payment line is no charge and the refund came after the payment (the cutoff).
    expect(toNumber(statement.totalAmount)).toBe(400);

    const rows = await live({ cardStatementId: r.statementId });
    expect(rows.map((e) => [e.description, toNumber(e.amount), e.importId, e.categoryId])).toEqual([
      ["Mercado", -120, imp.id, null],
      ["Notebook", -300, imp.id, null],
      ["Estorno Amazon", 20, imp.id, null],
    ]);
    expect(rows.find((e) => e.description === "Notebook")).toMatchObject({ installmentNumber: 1 });
    // The two later installments sit on the next statements, projected.
    expect((await live({ installmentNumber: { gt: 1 } })).map((e) => [e.installmentNumber, isProjected(e.metadata)])).toEqual([[2, true], [3, true]]);

    // Importing the same file again books nothing new.
    expect(await importCardFile(USER, { accountId: f.card, closingDate: "2026-09-05", dueDate: "2026-09-12", content: CSV }, prisma)).toMatchObject({ created: 0, skipped: 3 });
    expect(await live({ cardStatementId: r.statementId })).toHaveLength(3);
  });

  it("refuses a row with an unreadable date as import.invalid_file, writing nothing", async () => {
    const bad = "date,title,amount\nontem,Mercado,10.00\n";
    await expect(importCardFile(USER, { accountId: f.card, closingDate: "2026-09-05", dueDate: "2026-09-12", content: bad }, prisma)).rejects.toMatchObject({
      status: 400,
      code: "import.invalid_file",
      message: "Invalid date format: ontem",
    });
    expect(await prisma.cardStatement.count({ where: { accountId: f.card } })).toBe(0);
  });

  it("stores the FITID of an OFX line on the entry", async () => {
    const ofx = `<OFX><CCSTMTRS><CURDEF>BRL<BANKTRANLIST><STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260820120000<TRNAMT>-45.90<FITID>fit-uber<MEMO>Uber</STMTTRN></BANKTRANLIST></CCSTMTRS></OFX>`;
    await importCardFile(USER, { accountId: f.card, closingDate: "2026-09-05", dueDate: "2026-09-12", content: ofx }, prisma);
    expect((await live()).map((e) => [e.description, e.externalId])).toEqual([["Uber", "fit-uber"]]);
  });
});

describe("importCardStatement", () => {
  const row = (description: string, amount = 10, extra: Record<string, unknown> = {}) => ({ date: "2026-08-20", description, amount, ...extra });

  it("answers 404 for a card of someone else and 422 for an account that is no card", async () => {
    await expect(importCardStatement("nobody-else", { accountId: f.card, month: "2026-09", rows: [row("X")] }, prisma)).rejects.toMatchObject({ status: 404, code: "account.not_found" });
    await expect(importCardStatement(USER, { accountId: f.pfChecking, month: "2026-09", rows: [row("X")] }, prisma)).rejects.toMatchObject({ status: 422, code: "account.not_credit_card" });
  });

  it("sets the statement dates and total, and records the change so undoing the batch restores them", async () => {
    const first = await importCardStatement(USER, { accountId: f.card, month: "2026-09", rows: [row("A", 10)], fallback: "none" }, prisma);
    const before = await prisma.cardStatement.findUniqueOrThrow({ where: { id: first.statementId } });
    expect(before.totalAmount).toBeNull();

    const second = await importCardStatement(USER, { accountId: f.card, month: "2026-09", closingDate: "2026-09-04", dueDate: "2026-09-14", total: 321.5, rows: [row("B", 20)], fallback: "none" }, prisma);
    const after = await prisma.cardStatement.findUniqueOrThrow({ where: { id: first.statementId } });
    expect([after.closingDate?.toISOString().slice(0, 10), after.dueDate?.toISOString().slice(0, 10), toNumber(after.totalAmount)]).toEqual(["2026-09-04", "2026-09-14", 321.5]);
    expect((await live({ description: "B" }))[0].effectiveDate.toISOString().slice(0, 10)).toBe("2026-09-04");

    await undoBatch(USER, second.batchId!, prisma);
    const restored = await prisma.cardStatement.findUniqueOrThrow({ where: { id: first.statementId } });
    expect([restored.closingDate?.toISOString().slice(0, 10), restored.dueDate?.toISOString().slice(0, 10), restored.totalAmount]).toEqual(["2026-09-05", "2026-09-12", null]);
  });

  it("collects its records into the caller's batch instead of writing one, and writes none when it books nothing", async () => {
    const collect: { model: string; recordId: string }[] = [];
    const r = await importCardStatement(USER, { accountId: f.card, month: "2026-09", rows: [row("A")] }, prisma, { collect: collect as never });
    expect(r.batchId).toBeNull();
    expect(collect.map((c) => c.model)).toEqual(expect.arrayContaining(["CardStatement", "LedgerEntry"]));
    expect(await prisma.mutationBatch.count({ where: { userId: USER } })).toBe(0);

    const none = await importCardStatement(USER, { accountId: f.card, month: "2026-09", rows: [] }, prisma);
    expect(none).toMatchObject({ created: 0, skipped: 0, batchId: null });
  });

  describe("categories", () => {
    it("takes the category by id, by name (any case) and, with no choice, the system 'Other' (fallback other) or none", async () => {
      await importCardStatement(
        USER,
        { accountId: f.card, month: "2026-09", rows: [row("A", 1, { categoryId: f.categories.Software }), row("B", 2, { category: "groceries" }), row("C", 3), row("D", 4, { category: "no such category" })] },
        prisma
      );
      const byDesc = Object.fromEntries((await live()).map((e) => [e.description, e.categoryId]));
      expect(byDesc.A).toBe(f.categories.Software);
      expect(byDesc.B).toBe(f.categories.Groceries);
      const other = await prisma.category.findFirstOrThrow({ where: { userId: USER, systemKey: "other_system" } });
      expect(byDesc.C).toBe(other.id);
      expect(byDesc.D).toBe(other.id);

      await importCardStatement(USER, { accountId: f.card, month: "2026-10", rows: [row("E", 5)], fallback: "none" }, prisma);
      expect((await live({ description: "E" }))[0].categoryId).toBeNull();
    });

    it("refuses an unknown category id (404), an archived one by id and by name (422), and writes nothing", async () => {
      await expect(importCardStatement(USER, { accountId: f.card, month: "2026-09", rows: [row("A", 1, { categoryId: "nao-existe" })] }, prisma)).rejects.toMatchObject({ status: 404, code: "category.not_found" });
      await prisma.category.update({ where: { id: f.categories.Software }, data: { isArchived: true } });
      await expect(importCardStatement(USER, { accountId: f.card, month: "2026-09", rows: [row("A", 1, { categoryId: f.categories.Software })] }, prisma)).rejects.toMatchObject({
        status: 422,
        code: "category.archived",
        params: { name: "Software" },
      });
      await expect(importCardStatement(USER, { accountId: f.card, month: "2026-09", rows: [row("A", 1, { category: "software" })] }, prisma)).rejects.toMatchObject({
        status: 422,
        code: "category.archived",
        params: { name: "Software" },
      });
      expect(await prisma.cardStatement.count({ where: { accountId: f.card } })).toBe(0);
      expect(await live()).toHaveLength(0);
    });

    it("lets a matching rule categorize, counts its hits, and treats a chosen category equal to the rule's as the rule's doing", async () => {
      const rule = await prisma.categorizationRule.create({ data: { userId: USER, matchType: "contains", pattern: "uber", categoryId: f.categories.Groceries } });
      await importCardStatement(
        USER,
        {
          accountId: f.card,
          month: "2026-09",
          rows: [
            row("Uber Trip", 10),
            row("Uber Eats", 11, { categoryId: f.categories.Groceries }),
            row("Uber Pro", 12, { categoryId: f.categories.Software }),
            row("Uber Comida", 13, { category: "Groceries" }),
            row("Padaria", 14),
          ],
          fallback: "none",
        },
        prisma
      );
      const byDesc = Object.fromEntries((await live()).map((e) => [e.description, e]));
      expect(byDesc["Uber Trip"]).toMatchObject({ categoryId: f.categories.Groceries, isAutoCategorized: true, categorizedByRuleId: rule.id });
      expect(byDesc["Uber Eats"]).toMatchObject({ categoryId: f.categories.Groceries, isAutoCategorized: true, categorizedByRuleId: rule.id });
      expect(byDesc["Uber Comida"]).toMatchObject({ categoryId: f.categories.Groceries, isAutoCategorized: true, categorizedByRuleId: rule.id });
      expect(byDesc["Uber Pro"]).toMatchObject({ categoryId: f.categories.Software, isAutoCategorized: false, categorizedByRuleId: null });
      expect(byDesc.Padaria).toMatchObject({ categoryId: null, isAutoCategorized: false });
      const hit = await prisma.categorizationRule.findUniqueOrThrow({ where: { id: rule.id } });
      expect(hit.hitCount).toBe(3);
      expect(hit.lastHitAt).not.toBeNull();
    });
  });

  it("books a foreign-currency row at the user's rate for that currency, with the merchant name", async () => {
    await deleteLedgerFixture(prisma, USER);
    f = await createLedgerFixture(prisma, USER, { usdRate: 0.2 });
    await importCardStatement(USER, { accountId: f.card, month: "2026-09", rows: [row("Spotify", 10, { currency: "USD", merchantName: "Spotify AB" }), row("Local", 10)], fallback: "none" }, prisma);
    const byDesc = Object.fromEntries((await live()).map((e) => [e.description, e]));
    expect(byDesc.Spotify).toMatchObject({ currency: "USD", merchantName: "Spotify AB" });
    expect(toNumber(byDesc.Spotify.exchangeRate)).toBe(5);
    expect(toNumber(byDesc.Spotify.amountBase)).toBe(-50);
    expect(byDesc.Local).toMatchObject({ currency: "BRL", merchantName: null });
    expect(toNumber(byDesc.Local.amountBase)).toBe(-10);
  });

  describe("installments", () => {
    const installment = (n: number, total = 3, date = "2026-08-15") => row("Notebook", 1000, { date, installment: { number: n, total } });

    it("reuses the active plan of the same purchase and books only the installments still missing", async () => {
      await importCardStatement(USER, { accountId: f.card, month: "2026-09", rows: [installment(1)], fallback: "none" }, prisma);
      const plan = await prisma.installmentPlan.findFirstOrThrow({ where: { accountId: f.card } });
      expect(toNumber(plan.totalAmount)).toBe(3000);
      // The second installment arrives with its description carrying the "(2/3)" suffix the bank adds.
      await importCardStatement(USER, { accountId: f.card, month: "2026-10", rows: [{ ...installment(2), description: "Notebook (2/3)" }], fallback: "none" }, prisma);
      expect(await prisma.installmentPlan.count({ where: { accountId: f.card } })).toBe(1);
      const entries = await live({ installmentPlanId: plan.id });
      expect(entries.map((e) => [e.installmentNumber, isProjected(e.metadata)])).toEqual([[1, false], [2, false], [3, true]]);
    });

    it("starts another plan when the amount or the number of installments differ", async () => {
      await importCardStatement(USER, { accountId: f.card, month: "2026-09", rows: [installment(1, 3), installment(1, 6), { ...installment(1, 3), amount: 500 }], fallback: "none" }, prisma);
      expect(await prisma.installmentPlan.count({ where: { accountId: f.card } })).toBe(3);
    });

    it("books a single-installment row (1 of 1) as a plain charge, with no plan", async () => {
      await importCardStatement(USER, { accountId: f.card, month: "2026-09", rows: [installment(1, 1)], fallback: "none" }, prisma);
      expect(await prisma.installmentPlan.count({ where: { accountId: f.card } })).toBe(0);
      expect((await live())[0]).toMatchObject({ installmentPlanId: null, installmentNumber: 1 });
    });

    it("gives the real row the place of the projected one, and the undo brings the projection back", async () => {
      await importCardStatement(USER, { accountId: f.card, month: "2026-09", rows: [installment(1)], fallback: "none" }, prisma);
      const projectedBefore = await live({ installmentNumber: 2 });
      expect(projectedBefore).toHaveLength(1);
      const replaced = await importCardStatement(USER, { accountId: f.card, month: "2026-10", rows: [installment(2)], fallback: "none" }, prisma);
      const second = await live({ installmentNumber: 2 });
      expect(second).toHaveLength(1);
      expect(second[0].id).not.toBe(projectedBefore[0].id);
      expect(isProjected(second[0].metadata)).toBe(false);

      await undoBatch(USER, replaced.batchId!, prisma);
      const back = await live({ installmentNumber: 2 });
      expect(back.map((e) => [e.id, isProjected(e.metadata)])).toEqual([[projectedBefore[0].id, true]]);
    });
  });

  describe("rows the bill changed (updates)", () => {
    async function seed() {
      await importCardStatement(
        USER,
        { accountId: f.card, month: "2026-09", rows: [row("Restaurante", 87.9), row("Estorno loja", -30, { date: "2026-08-21" })], fallback: "none" },
        prisma
      );
      const entries = await live();
      return { charge: entries.find((e) => e.description === "Restaurante")!, refund: entries.find((e) => e.description === "Estorno loja")! };
    }

    it("keeps a charge a charge and a refund a refund when the amount changes, and applies the date and description", async () => {
      const { charge, refund } = await seed();
      const r = await importCardStatement(
        USER,
        {
          accountId: f.card,
          month: "2026-09",
          rows: [],
          updates: [
            { entryId: charge.id, amount: 90, date: "2026-08-22", description: "Restaurante Sabor" },
            { entryId: refund.id, amount: 40 },
          ],
        },
        prisma
      );
      expect(r.updated).toBe(2);
      const after = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: charge.id } });
      expect([toNumber(after.amount), after.description, after.date.toISOString().slice(0, 10)]).toEqual([-90, "Restaurante Sabor", "2026-08-22"]);
      expect(toNumber((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: refund.id } })).amount)).toBe(40);
    });

    it("answers 404 for an entry that is not a live row of this card", async () => {
      const { charge } = await seed();
      await prisma.ledgerEntry.update({ where: { id: charge.id }, data: { deletedAt: new Date() } });
      await expect(importCardStatement(USER, { accountId: f.card, month: "2026-09", rows: [], updates: [{ entryId: charge.id, amount: 1 }] }, prisma)).rejects.toMatchObject({
        status: 404,
        code: "entry.not_found",
      });
      await expect(importCardStatement(USER, { accountId: f.card, month: "2026-09", rows: [], updates: [{ entryId: "nao-existe", amount: 1 }] }, prisma)).rejects.toMatchObject({ code: "entry.not_found" });
    });

    it("moves the entry onto this statement and stores the line's FITID, under a ~dup id when another row of the card holds it", async () => {
      const { charge } = await seed();
      // An entry of the August statement (closing 2026-08-05), the bill now says it belongs to September.
      const older = await importCardStatement(USER, { accountId: f.card, month: "2026-08", rows: [row("Padaria", 12, { date: "2026-07-20" })], fallback: "none" }, prisma);
      const padaria = (await live({ cardStatementId: older.statementId }))[0];
      const sept = await prisma.cardStatement.findFirstOrThrow({ where: { accountId: f.card, month: "2026-09" } });
      await prisma.ledgerEntry.update({ where: { id: charge.id }, data: { externalId: "fit-1" } });

      const r = await importCardStatement(USER, { accountId: f.card, month: "2026-09", rows: [], updates: [{ entryId: padaria.id, externalId: "fit-1" }] }, prisma);
      expect(r.updated).toBe(1);
      const moved = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: padaria.id } });
      expect(moved).toMatchObject({ cardStatementId: sept.id, externalId: "fit-1~dup1" });
      expect(moved.effectiveDate.toISOString().slice(0, 10)).toBe("2026-09-05");
    });

    it("does not rewrite the FITID of an entry that already has the same line's (the ~dup suffix is the same line)", async () => {
      const { charge } = await seed();
      await prisma.ledgerEntry.update({ where: { id: charge.id }, data: { externalId: "fit-9~dup1" } });
      await importCardStatement(USER, { accountId: f.card, month: "2026-09", rows: [], updates: [{ entryId: charge.id, externalId: "fit-9" }] }, prisma);
      expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: charge.id } })).externalId).toBe("fit-9~dup1");
    });
  });

  describe("rows that left the bill (removeEntryIds)", () => {
    it("trashes the live rows of this statement and leaves the others", async () => {
      await importCardStatement(USER, { accountId: f.card, month: "2026-09", rows: [row("A", 1), row("B", 2)], fallback: "none" }, prisma);
      await importCardStatement(USER, { accountId: f.card, month: "2026-10", rows: [row("C", 3, { date: "2026-09-20" })], fallback: "none" }, prisma);
      const [a, b] = await live({ description: { in: ["A", "B"] } });
      const c = (await live({ description: "C" }))[0];

      const r = await importCardStatement(USER, { accountId: f.card, month: "2026-09", rows: [], removeEntryIds: [a.id, c.id, "nao-existe"] }, prisma);
      expect(r.removed).toBe(1);
      expect((await live()).map((e) => e.description).sort()).toEqual(["B", "C"]);
      expect(b.deletedAt).toBeNull();
    });

    it("does not trash a projected installment", async () => {
      await importCardStatement(USER, { accountId: f.card, month: "2026-09", rows: [{ date: "2026-08-15", description: "TV", amount: 100, installment: { number: 1, total: 2 } }], fallback: "none" }, prisma);
      await importCardStatement(USER, { accountId: f.card, month: "2026-10", rows: [], fallback: "none" }, prisma);
      const projected = (await live({ installmentNumber: 2 }))[0];
      const r = await importCardStatement(USER, { accountId: f.card, month: "2026-10", rows: [], removeEntryIds: [projected.id] }, prisma);
      expect(r.removed).toBe(0);
      expect(await live({ installmentNumber: 2 })).toHaveLength(1);
    });
  });

  it("leaves out of its duplicate check the rows the review already paired (matchedEntryIds)", async () => {
    await importCardStatement(USER, { accountId: f.card, month: "2026-09", rows: [row("Padaria", 12)], fallback: "none" }, prisma);
    const booked = (await live())[0];
    // Without matchedEntryIds the identical row is a duplicate; with it the booked row is taken, so the new one is booked.
    expect(await importCardStatement(USER, { accountId: f.card, month: "2026-09", rows: [row("Padaria", 12)], fallback: "none" }, prisma)).toMatchObject({ created: 0, skipped: 1 });
    expect(await importCardStatement(USER, { accountId: f.card, month: "2026-09", rows: [row("Padaria", 12)], matchedEntryIds: [booked.id], fallback: "none" }, prisma)).toMatchObject({ created: 1, skipped: 0 });
    expect(await live({ description: "Padaria" })).toHaveLength(2);
  });

  it("books a row the statement already has when asked (allowDuplicate)", async () => {
    await importCardStatement(USER, { accountId: f.card, month: "2026-09", rows: [row("Padaria", 12)], fallback: "none" }, prisma);
    const r = await importCardStatement(USER, { accountId: f.card, month: "2026-09", rows: [row("Padaria", 12, { allowDuplicate: true })], fallback: "none" }, prisma);
    expect(r).toMatchObject({ created: 1, skipped: 0 });
  });

  it("books a row under a ~dup external id when the card already holds that FITID", async () => {
    await importCardStatement(USER, { accountId: f.card, month: "2026-09", rows: [row("Padaria", 12, { externalId: "fit-1" })], fallback: "none" }, prisma);
    await importCardStatement(USER, { accountId: f.card, month: "2026-09", rows: [row("Padaria", 12, { externalId: "fit-1", allowDuplicate: true })], fallback: "none" }, prisma);
    expect((await live()).map((e) => e.externalId).sort()).toEqual(["fit-1", "fit-1~dup1"]);
  });
});

describe("excludeProjected and statementLedgerRows", () => {
  it("excludeProjected filters out only the projected installments, and nothing when there are none", async () => {
    expect(await excludeProjected(USER, prisma)).toEqual({});
    await importCardStatement(USER, { accountId: f.card, month: "2026-09", rows: [{ date: "2026-08-15", description: "TV", amount: 100, installment: { number: 1, total: 2 } }, { date: "2026-08-16", description: "Pao", amount: 5 }], fallback: "none" }, prisma);
    const projected = (await prisma.ledgerEntry.findMany({ where: { userId: USER, installmentNumber: 2 } }))[0];
    expect(await excludeProjected(USER, prisma)).toEqual({ id: { notIn: [projected.id] } });
    const kept = await prisma.ledgerEntry.findMany({ where: { userId: USER, ...(await excludeProjected(USER, prisma)) } });
    expect(kept.map((e) => e.description).sort()).toEqual(["Pao", "TV"]);
  });

  it("statementLedgerRows returns the booked rows of the statement and its neighbours in the statement convention, tagged by scope", async () => {
    expect(await statementLedgerRows(await prisma.account.findUniqueOrThrow({ where: { id: f.card } }), "2026-09", [], prisma)).toEqual([]);
    const importId = (await newImport()).id;
    await importCardStatement(USER, { accountId: f.card, month: "2026-09", rows: [{ date: "2026-08-20", description: "Mercado", amount: 50, externalId: "fit-m" }], importId, fallback: "none" }, prisma);
    await importCardStatement(USER, { accountId: f.card, month: "2026-08", rows: [{ date: "2026-07-20", description: "Padaria", amount: 12 }], importId, fallback: "none" }, prisma);
    await importCardStatement(USER, { accountId: f.card, month: "2026-06", rows: [{ date: "2026-05-20", description: "Longe", amount: 7, externalId: "fit-far" }], importId, fallback: "none" }, prisma);
    await importCardStatement(USER, { accountId: f.card, month: "2026-09", rows: [{ date: "2026-08-21", description: "USD", amount: 9, currency: "USD" }], importId, fallback: "none" }, prisma);

    const card = await prisma.account.findUniqueOrThrow({ where: { id: f.card } });
    const rows = await statementLedgerRows(card, "2026-09", ["fit-far~dup2"], prisma);
    const byDesc = Object.fromEntries(rows.map((r) => [r.description, r]));
    expect(byDesc.Mercado).toMatchObject({ amount: 50, scope: "target", date: "2026-08-20", manual: false, foreign: false, externalId: "fit-m" });
    expect(byDesc.Padaria).toMatchObject({ amount: 12, scope: "neighbor" });
    // Held by its external id only (the file's ~dup suffix is ignored): reachable, but "elsewhere".
    expect(byDesc.Longe).toMatchObject({ scope: "elsewhere" });
    expect(byDesc.USD).toMatchObject({ foreign: true });

    // A manual entry is flagged as typed by hand.
    const manual = await createEntry(USER, { kind: "expense", accountId: f.card, amount: 3, description: "Manual", date: "2026-08-22" }, prisma);
    const again = await statementLedgerRows(card, "2026-09", [], prisma);
    expect(again.find((r) => r.id === manual.entryIds[0])).toMatchObject({ manual: true });
  });
});
