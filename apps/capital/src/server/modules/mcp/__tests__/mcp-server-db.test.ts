import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { prisma } from "@capital/server/lib/prisma";
import { createEntry } from "@capital/server/modules/ledger/services/entries";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { createCapitalMcpServer } from "../lib/mcp-server";

/**
 * The MCP server against the real database: the tools run through the
 * protocol (zod validation, JSON text envelope) into the real services, and
 * the assertions look at the rows left behind.
 */
const USER = "test-user-mcp-server-db";
const OTHER = "test-user-mcp-server-db-other";
const MISSING = "00000000-0000-4000-8000-000000000000";
let f: LedgerFixture;

beforeEach(async () => {
  f = await createLedgerFixture(prisma, USER, {
    categories: [
      { name: "Groceries", type: "expense" },
      { name: "Salary", type: "income" },
    ],
  });
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
  await deleteLedgerFixture(prisma, OTHER);
});

type ToolResult = { content: Array<{ type: string; text: string }>; isError?: boolean };

async function withClient<T>(fn: (call: (name: string, args?: Record<string, unknown>) => Promise<ToolResult>) => Promise<T>, userId = USER, readOnly = false): Promise<T> {
  const server = createCapitalMcpServer(userId, prisma, { readOnly });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "db-test", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    return await fn(async (name, args = {}) => (await client.callTool({ name, arguments: args })) as ToolResult);
  } finally {
    await client.close();
    await server.close();
  }
}

const json = <T = Record<string, unknown>>(r: ToolResult): T => {
  expect(r.isError, r.content[0]?.text).toBeFalsy();
  return JSON.parse(r.content[0].text) as T;
};

describe("MCP server against the database", () => {
  it("books, lists, edits and trashes a transaction through the tools", async () => {
    await withClient(async (call) => {
      const created = json<{ created: Array<{ id: string; amount: number; description: string }>; errors: unknown[] }>(
        await call("bulk_create_transactions", {
          transactions: [
            { entityType: "personal", type: "expense", amount: 42.5, currency: "BRL", description: "Padaria", category: "Groceries", date: "2026-09-10", personalAccountId: f.pfId },
            { entityType: "personal", type: "income", amount: 3000, currency: "BRL", description: "Pagamento", category: "Salary", date: "2026-09-05", personalAccountId: f.pfId },
          ],
        }),
      );
      expect(created.errors).toEqual([]);
      expect(created.created).toHaveLength(2);
      const expense = created.created.find((c) => c.description === "Padaria")!;

      const rows = await prisma.ledgerEntry.findMany({ where: { userId: USER }, orderBy: { date: "asc" } });
      expect(rows.map((r) => [r.kind, Number(r.amount), r.description])).toEqual([
        ["income", 3000, "Pagamento"],
        ["expense", -42.5, "Padaria"],
      ]);

      const listed = json<{ transactions: Array<{ id: string; amount: number }>; summaries: Array<{ type: string; category: string; total: number; count: number }> }>(
        await call("list_transactions", { dateFrom: "2026-09-01", dateTo: "2026-09-30" }),
      );
      expect(listed.transactions).toHaveLength(2);
      expect(listed.summaries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "expense", category: "Groceries", total: 42.5, count: 1, currency: "BRL" }),
          expect.objectContaining({ type: "income", category: "Salary", total: 3000, count: 1 }),
        ]),
      );

      const updated = json<{ id: string; amount: number; description: string }>(
        await call("update_transaction", { id: expense.id, amount: 50, description: "Padaria do Zé" }),
      );
      expect(updated).toMatchObject({ id: expense.id, amount: 50, description: "Padaria do Zé" });
      expect(Number((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: expense.id } })).amount)).toBe(-50);

      expect(json(await call("delete_transaction", { id: expense.id }))).toEqual({ success: true, id: expense.id });
      expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: expense.id } })).deletedAt).not.toBeNull();
      const afterDelete = json<{ transactions: unknown[] }>(await call("list_transactions", {}));
      expect(afterDelete.transactions).toHaveLength(1);
    });

    // Every write above landed in an undo batch attributed to the MCP client.
    const sources = (await prisma.mutationBatch.findMany({ where: { userId: USER } })).map((b) => b.source);
    expect(sources.length).toBeGreaterThanOrEqual(3);
    expect(new Set(sources)).toEqual(new Set(["mcp"]));
  });

  it("creates, lists, renames, archives, merges and deletes categories", async () => {
    await withClient(async (call) => {
      const pets = json<{ id: string; name: string; type: string }>(await call("create_category", { name: "Pets", type: "expense", color: "#abcdef" }));
      expect(pets).toMatchObject({ name: "Pets", type: "expense" });
      expect(await prisma.category.count({ where: { userId: USER, name: "Pets" } })).toBe(1);

      const duplicate = await call("create_category", { name: "Pets", type: "expense" });
      expect(duplicate.isError).toBe(true);
      expect(duplicate.content[0].text).toMatch(/already exists/);

      const renamed = json<{ name: string }>(await call("update_category", { id: pets.id, name: "Animais" }));
      expect(renamed.name).toBe("Animais");

      const listed = json<{ categories: Array<{ name: string; isArchived: boolean; transactionCount: number }> }>(await call("list_categories", { type: "expense" }));
      expect(listed.categories.map((c) => c.name).sort()).toEqual(["Animais", "Groceries"]);

      await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 10, date: "2026-09-02", description: "Ração", categoryId: pets.id }, prisma, { skipRules: true });
      await call("update_category", { id: pets.id, isArchived: true });
      const visible = json<{ categories: Array<{ name: string }> }>(await call("list_categories", { type: "expense" }));
      expect(visible.categories.map((c) => c.name)).toEqual(["Groceries"]);
      const withArchived = json<{ categories: Array<{ name: string; isArchived: boolean }> }>(await call("list_categories", { type: "expense", includeArchived: true }));
      expect(withArchived.categories.find((c) => c.name === "Animais")?.isArchived).toBe(true);

      const merged = json<{ success: boolean; transactionsMoved: number }>(await call("merge_categories", { fromId: pets.id, toId: f.categories.Groceries }));
      expect(merged).toMatchObject({ success: true, transactionsMoved: 1 });
      expect(await prisma.category.count({ where: { id: pets.id } })).toBe(0);
      expect(await prisma.ledgerEntry.count({ where: { userId: USER, categoryId: f.categories.Groceries } })).toBe(1);

      const extra = json<{ id: string }>(await call("create_category", { name: "Extra", type: "income" }));
      expect(json(await call("delete_category", { id: extra.id }))).toMatchObject({ success: true, id: extra.id });
      expect(await prisma.category.count({ where: { id: extra.id } })).toBe(0);
    });
  });

  it("find_orphan_transactions groups the uncategorized entries", async () => {
    await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 7, date: "2026-09-03", description: "Sem categoria" }, prisma, { skipRules: true });
    await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 9, date: "2026-09-04", description: "Com categoria", categoryId: f.categories.Groceries }, prisma, { skipRules: true });
    await withClient(async (call) => {
      const r = json<{ total: number; categories: Array<{ name: string; count: number }>; transactions: Array<{ description: string; category: string | null }> }>(
        await call("find_orphan_transactions"),
      );
      expect(r.total).toBe(1);
      expect(r.categories).toEqual([{ name: "(none)", count: 1 }]);
      expect(r.transactions.map((t) => [t.description, t.category])).toEqual([["Sem categoria", null]]);
    });
  });

  it("reads and writes user and account settings", async () => {
    await withClient(async (call) => {
      expect(json(await call("get_settings"))).toMatchObject({ baseCurrency: "BRL" });
      expect(json(await call("update_settings", { theme: "dark", timezone: "UTC" }))).toMatchObject({ theme: "dark", timezone: "UTC", baseCurrency: "BRL" });
      expect((await prisma.user.findUniqueOrThrow({ where: { id: USER } })).theme).toBe("dark");

      const account = json<{ name: string; taxRate: number; initialBalance: number }>(
        await call("update_account", { accountId: f.pjId, entityType: "business", name: "Kodama Labs", taxRate: 0.06, initialBalance: 250 }),
      );
      expect(account).toMatchObject({ name: "Kodama Labs", taxRate: 0.06, initialBalance: 250 });
      expect((await prisma.entity.findUniqueOrThrow({ where: { id: f.pjId } })).name).toBe("Kodama Labs");

      const wrongKind = await call("update_account", { accountId: f.pfId, entityType: "business", name: "x" });
      expect(wrongKind.isError).toBe(true);
      expect(wrongKind.content[0].text).toMatch(/Business account not found/);
    });
  });

  it("lists the entities, the ledger accounts, their balances and the valid types", async () => {
    await createEntry(USER, { kind: "income", accountId: f.pfChecking, amount: 1000, date: "2026-09-01", description: "Entrada" }, prisma, { skipRules: true });
    await withClient(async (call) => {
      const accounts = json<{ businesses: Array<{ id: string; name: string }>; personalAccount: { id: string } | null }>(await call("list_accounts"));
      expect(accounts.personalAccount?.id).toBe(f.pfId);
      expect(accounts.businesses.map((b) => [b.id, b.name])).toEqual([[f.pjId, "Kodama LTDA"]]);

      expect(json(await call("get_valid_types"))).toEqual({ types: ["income", "expense", "investment"] });

      const ledger = json<{ accounts: Array<{ id: string; type: string }> }>(await call("list_ledger_accounts", { type: "brokerage" }));
      expect(ledger.accounts.map((a) => [a.id, a.type])).toEqual([[f.broker, "brokerage"]]);

      const balances = json<{ baseCurrency: string; accounts: Array<{ id: string; balance: number; balanceBase: number }> }>(await call("list_account_balances"));
      expect(balances.baseCurrency).toBe("BRL");
      expect(balances.accounts.find((a) => a.id === f.pfChecking)).toMatchObject({ balance: 1000, balanceBase: 1000 });
      const before = json<{ accounts: Array<{ id: string; balance: number }> }>(await call("list_account_balances", { asOf: "2026-08-31" }));
      expect(before.accounts.find((a) => a.id === f.pfChecking)?.balance).toBe(0);
    });
  });

  it("answers a read-only token's read tools and hides the write ones", async () => {
    await withClient(
      async (call) => {
        expect(json(await call("get_valid_types"))).toEqual({ types: ["income", "expense", "investment"] });
        const blocked = await call("create_category", { name: "Nope", type: "expense" }).catch((e: Error) => e.message);
        expect(typeof blocked === "string" ? blocked : blocked.content[0].text).toMatch(/not found/i);
        expect(await prisma.category.count({ where: { userId: USER, name: "Nope" } })).toBe(0);
      },
      USER,
      true,
    );
  });

  it("scopes every tool to the authenticated user", async () => {
    const other = await createLedgerFixture(prisma, OTHER, { categories: [{ name: "Mercado", type: "expense" }] });
    const {
      entryIds: [entryId],
    } = await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 5, date: "2026-09-02", description: "Meu", categoryId: f.categories.Groceries }, prisma, { skipRules: true });

    await withClient(async (call) => {
      const listed = json<{ transactions: unknown[] }>(await call("list_transactions", {}));
      expect(listed.transactions).toHaveLength(0);
      const cats = json<{ categories: Array<{ name: string }> }>(await call("list_categories", {}));
      expect(cats.categories.map((c) => c.name)).toEqual(["Mercado"]);

      const del = await call("delete_transaction", { id: entryId });
      expect(del.isError).toBe(true);
      const upd = await call("update_category", { id: f.categories.Groceries, name: "Hacked" });
      expect(upd.isError).toBe(true);
      const missing = await call("update_transaction", { id: MISSING, amount: 1 });
      expect(missing.isError).toBe(true);
    }, OTHER);

    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: entryId } })).deletedAt).toBeNull();
    expect((await prisma.category.findUniqueOrThrow({ where: { id: f.categories.Groceries } })).name).toBe("Groceries");
    expect(other.userId).toBe(OTHER);
  });

  it("get_fire_plan reports no goal for a user without a plan", async () => {
    await withClient(async (call) => {
      expect(json(await call("get_fire_plan"))).toMatchObject({ hasGoal: false });
    });
  });
});
