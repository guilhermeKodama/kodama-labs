import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { createEntry } from "@capital/server/modules/ledger/services/entries";
import { markStatementPayment } from "@capital/server/modules/ledger/services/statements";
import { importCardStatement } from "@capital/server/modules/credit-cards/services/import-card-statement";
import { listTransactions } from "../list-transactions";

const USER = "test-user-mcp-list-statements-001";
let f: LedgerFixture;

beforeAll(async () => {
  f = await createLedgerFixture(prisma, USER, { usdRate: 0.2 });
  // October statement (closes 2026-10-05): a BRL purchase, a USD one, and installment 10/12 of a January purchase.
  const { statementId } = await importCardStatement(
    USER,
    {
      accountId: f.card,
      month: "2026-10",
      rows: [
        { date: "2026-09-20", description: "Mercado", amount: 200, categoryId: f.categories.Groceries },
        { date: "2026-09-22", description: "GitHub", amount: 10, currency: "USD", categoryId: f.categories.Software },
        { date: "2026-01-15", description: "Notebook", amount: 300, categoryId: f.categories.Software, installment: { number: 10, total: 12 } },
      ],
    },
    prisma
  );
  const payment = await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 550, date: "2026-10-12", description: "Pagamento fatura" }, prisma);
  await markStatementPayment(USER, payment.entryIds[0], statementId, prisma);
  await createEntry(USER, { kind: "income", accountId: f.pfChecking, amount: 5000, date: "2026-10-01", description: "Salário", categoryId: f.categories.Salary }, prisma);
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

describe("listTransactions", () => {
  it("summarizes October in base currency with card purchases on the closing date and no bill payment", async () => {
    const r = await listTransactions(USER, { dateFrom: "2026-10-01", dateTo: "2026-10-31" }, prisma);
    const by = Object.fromEntries(r.summaries.map((s) => [`${s.type}|${s.category}`, [Math.round(s.total * 100) / 100, s.count]]));
    expect(by).toEqual({
      "expense|Groceries": [200, 1],
      "expense|Software": [350, 2],
      "income|Salary": [5000, 1],
    });
    expect(r.transactions.find((t) => t.description === "Pagamento fatura")).toBeUndefined();
    expect(r.transactions.every((t) => t.personalAccountId === f.pfId && t.amount > 0)).toBe(true);
  });

  it("filters by type and category", async () => {
    const r = await listTransactions(USER, { dateFrom: "2026-10-01", dateTo: "2026-10-31", type: "expense", category: "Software" }, prisma);
    expect(r.transactions.map((t) => t.description).sort()).toEqual(["GitHub", "Notebook"]);
  });
});
