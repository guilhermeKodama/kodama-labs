import { describe, expect, it } from "vitest";
import type { HistoryEvent } from "@capital/server/modules/ledger/services/history";
import { bulkPatch, changedRows, changes, nextField, readyChanges, type BulkEditRow } from "@/lib/ledger/bulk-edit";
import { deletedToast, needsScopeQuestion, scopesOf, yearSpan } from "@/lib/ledger/delete-scope";
import { fieldGender, historyLines } from "@/lib/ledger/entry-history";
import { trashRows } from "@/lib/ledger/trash";

describe("historyLines", () => {
  const at = "2026-09-23T12:12:00.000Z";
  const created = { type: "created" as const, at, batchId: "b1", source: "import", op: "import", import: null, recurringRule: null, installment: null, duplicatedFrom: null };

  it("tells where the entry came from", () => {
    const imported: HistoryEvent = {
      ...created,
      import: { id: "i", bankName: "Nubank", fileName: "nubank.ofx", fileType: "OFX", source: "manual", createdAt: at, revertedAt: null },
    };
    expect(historyLines([imported])).toEqual([{ key: "imported", label: "OFX Nubank", at, time: "dateTime" }]);
    expect(historyLines([{ ...created, source: "user", recurringRule: { id: "r", description: "Aluguel", frequency: "monthly", isActive: true } }])[0]).toMatchObject({ key: "fromRecurrence", description: "Aluguel" });
    expect(historyLines([{ ...created, installment: { n: 3, total: 10 } }])[0]).toMatchObject({ key: "installment", n: 3, total: 10 });
    expect(historyLines([{ ...created, source: "assistant" }])[0]).toMatchObject({ key: "created", actor: "assistant" });
    expect(historyLines([{ ...created, source: null }])[0]).toMatchObject({ key: "created", actor: "user" });
  });

  it("names the rule and the edited fields in reading order", () => {
    const events: HistoryEvent[] = [
      { type: "categorized", at: "2026-09-23T12:12:00.000Z", by: "rule", rule: { id: "r", pattern: "ifood", matchType: "contains" }, categoryId: "c" },
      {
        type: "updated",
        at,
        batchId: "b2",
        source: "user",
        op: "update",
        changes: [
          { field: "categoryId", before: "a", after: "b" },
          { field: "amount", before: 1, after: 2 },
        ],
      },
      { type: "deleted", at, batchId: "b3", source: "mcp", op: "delete" },
    ];
    expect(historyLines(events)).toEqual([
      { key: "categorizedByRule", pattern: "ifood", at: "2026-09-23T12:12:00.000Z", time: "date" },
      { key: "updated", fields: ["amount", "categoryId"], actor: "user", at, time: "relative" },
      { key: "deleted", actor: "mcp", at, time: "relative" },
    ]);
  });

  it("says auto-categorized when no rule is known", () => {
    expect(historyLines([{ type: "categorized", at: null, by: "auto", rule: null, categoryId: "c" }])).toEqual([{ key: "categorizedAuto", at: null, time: "date" }]);
  });

  it("knows the gender of each field's noun", () => {
    expect(fieldGender("amount")).toBe("m");
    expect(fieldGender("categoryId")).toBe("f");
  });
});

describe("delete scope", () => {
  it("asks first only for rows that may take more with them", () => {
    expect(needsScopeQuestion({ kind: "expense" })).toBe(false);
    expect(needsScopeQuestion({ kind: "expense", installmentPlanId: "p" })).toBe(true);
    expect(needsScopeQuestion({ kind: "expense", isRecurring: true })).toBe(true);
    expect(needsScopeQuestion({ kind: "transfer", transferDirection: "investment_deposit" })).toBe(true);
    expect(needsScopeQuestion({ kind: "investment" })).toBe(true);
    expect(needsScopeQuestion({ kind: "transfer", transferDirection: "profit_distribution" })).toBe(false);
  });

  it("offers the scopes the server summed", () => {
    const sum = { count: 1, sum: 1, from: "2026-01-01", to: "2026-01-01" };
    expect(scopesOf({ kind: "recurring", scopes: { one: sum, future: sum, all: sum } })).toEqual(["one", "future", "all"]);
    expect(scopesOf({ kind: "linked", scopes: { one: sum } })).toEqual(["one"]);
  });

  it("reads the years and picks the toast", () => {
    expect(yearSpan("2025-11-05", "2026-09-05")).toEqual({ from: 2025, to: 2026 });
    expect(yearSpan("", "")).toBeNull();
    expect(deletedToast({ kind: "linked" }, "one", true).key).toBe("linked");
    expect(deletedToast({ kind: "linked" }, "one", false).key).toBe("simple");
    expect(deletedToast({ kind: "installment" }, "future", true)).toEqual({ key: "scoped", scope: "future" });
  });
});

describe("bulk edit", () => {
  const row = (patch: Partial<BulkEditRow>): BulkEditRow => ({
    id: "e",
    kind: "expense",
    description: "iFood",
    categoryId: "rest",
    entityId: "pf",
    accountId: "nubank",
    isTaxDeductible: false,
    transferGroupId: null,
    ...patch,
  });

  it("marks rows that would not change, transfers included", () => {
    expect(changes(row({}), { field: "categoryId", value: "lazer" })).toBe(true);
    expect(changes(row({}), { field: "categoryId", value: "rest" })).toBe(false);
    expect(changes(row({ kind: "transfer", transferGroupId: "g" }), { field: "categoryId", value: "lazer" })).toBe(false);
    expect(changes(row({ kind: "transfer", transferGroupId: "g" }), { field: "entityId", value: "ltda" })).toBe(false);
    expect(changes(row({}), { field: "isTaxDeductible", value: "yes" })).toBe(true);
  });

  it("builds one patch from several fields, the account winning over the entity", () => {
    const list = [
      { field: "categoryId" as const, value: "lazer" },
      { field: "entityId" as const, value: "ltda" },
      { field: "accountId" as const, value: "inter" },
      { field: "isTaxDeductible" as const, value: "no" },
    ];
    expect(bulkPatch(list)).toEqual({ categoryId: "lazer", accountId: "inter", isTaxDeductible: false });
    expect(readyChanges([{ field: "categoryId", value: "" }])).toEqual([]);
    expect(changedRows([row({}), row({ id: "f", categoryId: "lazer" })], [{ field: "categoryId", value: "lazer" }])).toBe(1);
    expect(nextField(list.slice(0, 2))).toBe("accountId");
    expect(nextField(list)).toBeNull();
  });
});

describe("trashRows", () => {
  it("shows a transfer once, from its outflow leg", () => {
    const rows = trashRows([
      { id: "a", date: "2026-09-01", description: "Aporte", amountBase: 1000, accountId: "xp", entityId: "pf", transferGroupId: "g", deletedAt: "x" },
      { id: "b", date: "2026-09-01", description: "Aporte", amountBase: -1000, accountId: "nubank", entityId: "pf", transferGroupId: "g", deletedAt: "x" },
      { id: "c", date: "2026-09-02", description: "iFood", amountBase: -86.9, accountId: "card", entityId: "pf", transferGroupId: null, deletedAt: "x" },
    ]);
    expect(rows).toEqual([
      { id: "a", date: "2026-09-01", description: "Aporte", amount: 1000, transfer: true, accountId: "nubank", toAccountId: "xp", entityId: "pf", deletedAt: "x" },
      { id: "c", date: "2026-09-02", description: "iFood", amount: -86.9, transfer: false, accountId: "card", toAccountId: null, entityId: "pf", deletedAt: "x" },
    ]);
  });
});
