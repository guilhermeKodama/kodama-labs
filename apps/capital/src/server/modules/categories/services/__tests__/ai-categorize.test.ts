import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Claude is never called: the default categorizers are the mocks below.
const claude = vi.hoisted(() => ({ categorizeBillTransactions: vi.fn(), categorizeStatementTransactions: vi.fn() }));
vi.mock("@capital/server/lib/claude", () => claude);

import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import type { Prisma } from "@/generated/prisma";
import { AI_CATEGORIZE_CHUNK_SIZE, categorizePendingEntries, type AiCategorizers } from "../ai-categorize";
import { getSystemCategory } from "../../lib/system-categories";

const USER = "test-user-categories-ai-001";
const OTHER = "test-user-categories-ai-002";
let f: LedgerFixture;
let o: LedgerFixture;
let importId: string;

beforeEach(async () => {
  claude.categorizeBillTransactions.mockReset();
  claude.categorizeStatementTransactions.mockReset();
  f = await createLedgerFixture(prisma, USER, {
    categories: [
      { name: "Mercado", type: "expense" },
      { name: "Software", type: "expense" },
      { name: "Salario", type: "income" },
    ],
  });
  o = await createLedgerFixture(prisma, OTHER);
  importId = (await prisma.import.create({ data: { userId: USER, entityId: f.pfId, accountId: f.pfChecking, transactionCount: 4 } })).id;
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
  await deleteLedgerFixture(prisma, OTHER);
});

/** A row the importer left uncategorized (written directly: this is the state the cron picks up). */
const pending = (accountId: string, kind: "income" | "expense", description: string, extra: Record<string, unknown> = {}, userId = USER, entityId = f.pfId) =>
  prisma.ledgerEntry.create({
    data: {
      userId,
      entityId,
      accountId,
      kind,
      amount: kind === "expense" ? -25 : 25,
      currency: "BRL",
      amountBase: kind === "expense" ? -25 : 25,
      date: new Date("2026-09-10T12:00:00Z"),
      effectiveDate: new Date("2026-09-10T12:00:00Z"),
      description,
      importId,
      ...extra,
    } as Prisma.LedgerEntryUncheckedCreateInput,
  });
const answers = (category: string) => async (rows: { index: number }[]) => rows.map((r) => ({ index: r.index, category }));
const statementAnswers = (category: string): AiCategorizers["statement"] => async (rows) => rows.map((r) => ({ index: r.index, category }));

describe("categorizePendingEntries", () => {
  it("answers an empty result when nothing is pending, for anyone or for one user", async () => {
    expect(await categorizePendingEntries(prisma, {}, USER)).toEqual({ userId: null, processed: 0, remaining: 0 });
    await pending(f.pfChecking, "expense", "Manual", { importId: null });
    expect(await categorizePendingEntries(prisma, {}, USER)).toEqual({ userId: null, processed: 0, remaining: 0 });
    expect(claude.categorizeBillTransactions).not.toHaveBeenCalled();
    expect(claude.categorizeStatementTransactions).not.toHaveBeenCalled();
  });

  it("sends card rows to the bill prompt and bank rows to the statement prompt, expense and income apart", async () => {
    await pending(f.card, "expense", "Padaria Real");
    await pending(f.pfChecking, "expense", "Pix para Maria");
    await pending(f.pfChecking, "income", "Cliente");
    claude.categorizeBillTransactions.mockImplementation(answers("Mercado"));
    claude.categorizeStatementTransactions.mockImplementation(async (rows: { index: number }[], _c: string[], type: string) => rows.map((r) => ({ index: r.index, category: type === "income" ? "Salario" : "Software" })));

    const r = await categorizePendingEntries(prisma, {}, USER);
    expect(r).toEqual({ userId: USER, processed: 3, remaining: 0 });
    expect(claude.categorizeBillTransactions).toHaveBeenCalledTimes(1);
    expect(claude.categorizeStatementTransactions).toHaveBeenCalledTimes(2);
    const [billRows, billCategories, billFallback] = claude.categorizeBillTransactions.mock.calls[0];
    expect(billRows).toEqual([{ index: 0, description: "Padaria Real", merchantName: undefined, amount: 25 }]);
    expect(billCategories).toEqual(expect.arrayContaining(["Mercado", "Software", billFallback]));
    expect(billCategories).not.toContain("Salario");
    const types = claude.categorizeStatementTransactions.mock.calls.map((c) => c[2]).sort();
    expect(types).toEqual(["expense", "income"]);
    const incomeCall = claude.categorizeStatementTransactions.mock.calls.find((c) => c[2] === "income")!;
    expect(incomeCall[1]).toContain("Salario");

    const rows = await prisma.ledgerEntry.findMany({ where: { userId: USER }, orderBy: { description: "asc" } });
    expect(Object.fromEntries(rows.map((e) => [e.description, e.categoryId]))).toEqual({
      Cliente: f.categories.Salario,
      "Padaria Real": f.categories.Mercado,
      "Pix para Maria": f.categories.Software,
    });
    expect(rows.every((e) => e.isAutoCategorized)).toBe(true);
  });

  it("leaves digit runs out of what Claude sees, and passes the merchant along", async () => {
    await pending(f.card, "expense", "PIX 123.456.789-00 LOJA 123456789", { merchantName: "Loja 99999 Ltda" });
    claude.categorizeBillTransactions.mockImplementation(answers("Mercado"));
    await categorizePendingEntries(prisma, {}, USER);
    const [rows] = claude.categorizeBillTransactions.mock.calls[0];
    expect(rows[0].description).toBe("PIX •••• LOJA ••••");
    expect(rows[0].merchantName).toBe("Loja •••• Ltda");
    expect(rows[0].description).not.toMatch(/\d{5}/);
  });

  it("files an answer it does not know, or the fallback, under the system Other and learns nothing from it", async () => {
    const otherExpense = await getSystemCategory(USER, "other_system", prisma);
    const otherIncome = await getSystemCategory(USER, "other_income", prisma);
    await pending(f.card, "expense", "Misterio");
    await pending(f.pfChecking, "income", "Estranho");
    claude.categorizeBillTransactions.mockImplementation(answers("Categoria Inventada"));
    claude.categorizeStatementTransactions.mockImplementation(async (rows: { index: number }[], _c: string[], _t: string, fallback: string) => rows.map((r) => ({ index: r.index, category: fallback })));
    await categorizePendingEntries(prisma, {}, USER);
    const rows = await prisma.ledgerEntry.findMany({ where: { userId: USER } });
    expect(rows.find((e) => e.description === "Misterio")?.categoryId).toBe(otherExpense.id);
    expect(rows.find((e) => e.description === "Estranho")?.categoryId).toBe(otherIncome.id);
    expect(await prisma.categorizationRule.count({ where: { userId: USER } })).toBe(0);
  });

  it("ignores an answer about a row that was not sent, and a row Claude did not answer stays pending", async () => {
    await pending(f.card, "expense", "Primeira");
    await pending(f.card, "expense", "Segunda");
    claude.categorizeBillTransactions.mockResolvedValue([{ index: 0, category: "Mercado" }, { index: 7, category: "Mercado" }]);
    const r = await categorizePendingEntries(prisma, {}, USER);
    expect(r).toEqual({ userId: USER, processed: 1, remaining: 1 });
    expect(await prisma.ledgerEntry.count({ where: { userId: USER, categoryId: null } })).toBe(1);
    expect((await prisma.import.findUniqueOrThrow({ where: { id: importId } })).categorizationStatus).toBe("processing");
  });

  it("learns an ai rule per distinct answer, moves an ai rule, skips a manual one and a blank description", async () => {
    await prisma.categorizationRule.create({ data: { userId: USER, matchType: "equals", pattern: "assinatura", categoryId: f.categories.Mercado, source: "ai" } });
    await prisma.categorizationRule.create({ data: { userId: USER, matchType: "equals", pattern: "feira", categoryId: f.categories.Mercado, source: "manual" } });
    await pending(f.card, "expense", "Assinatura");
    await pending(f.card, "expense", "Feira");
    await pending(f.card, "expense", "Novo Lugar");
    await pending(f.card, "expense", "   ");
    claude.categorizeBillTransactions.mockImplementation(answers("Software"));
    const r = await categorizePendingEntries(prisma, {}, USER);
    expect(r.processed).toBe(4);
    const rules = await prisma.categorizationRule.findMany({ where: { userId: USER }, orderBy: { pattern: "asc" } });
    expect(rules.map((x) => [x.pattern, x.source, x.categoryId])).toEqual([
      ["assinatura", "ai", f.categories.Software],
      ["feira", "manual", f.categories.Mercado],
      ["novo lugar", "ai", f.categories.Software],
    ]);
  });

  it("picks rows by their origin: an import, a card statement or a Pluggy sync, never a plain manual entry or someone else's", async () => {
    await pending(f.pfChecking, "expense", "Importada");
    await pending(f.pfChecking, "expense", "Pluggy", { importId: null, metadata: { source: "pluggy" } });
    await pending(f.pfChecking, "expense", "Manual", { importId: null });
    await pending(f.pfChecking, "expense", "Transferencia", { transferGroupId: (await prisma.transferGroup.create({ data: { userId: USER, direction: "between_accounts", date: new Date("2026-09-10T12:00:00Z") } })).id, kind: "transfer" });
    await pending(f.pfChecking, "expense", "Apagada", { deletedAt: new Date() });
    await pending(o.pfChecking, "expense", "Alheia", {}, OTHER, o.pfId);
    claude.categorizeStatementTransactions.mockImplementation(answers("Mercado"));
    const mine = await categorizePendingEntries(prisma, {}, USER);
    expect(mine).toEqual({ userId: USER, processed: 2, remaining: 0 });
    expect((await prisma.ledgerEntry.findFirstOrThrow({ where: { userId: OTHER } })).categoryId).toBeNull();
    const theirs = await categorizePendingEntries(prisma, { statement: statementAnswers("Mercado") }, OTHER);
    expect(theirs).toMatchObject({ userId: OTHER, processed: 1 });
  });

  it("takes one chunk at a time, and marks the import completed once its last row is done", async () => {
    const total = AI_CATEGORIZE_CHUNK_SIZE + 3;
    for (let i = 0; i < total; i++) await pending(f.card, "expense", `Compra ${i}`);
    claude.categorizeBillTransactions.mockImplementation(answers("Mercado"));
    const first = await categorizePendingEntries(prisma, {}, USER);
    expect(first).toEqual({ userId: USER, processed: AI_CATEGORIZE_CHUNK_SIZE, remaining: 3 });
    expect(claude.categorizeBillTransactions.mock.calls[0][0]).toHaveLength(AI_CATEGORIZE_CHUNK_SIZE);
    expect((await prisma.import.findUniqueOrThrow({ where: { id: importId } })).categorizationStatus).toBe("processing");
    const second = await categorizePendingEntries(prisma, {}, USER);
    expect(second).toEqual({ userId: USER, processed: 3, remaining: 0 });
    expect((await prisma.import.findUniqueOrThrow({ where: { id: importId } })).categorizationStatus).toBe("completed");
  });
});
