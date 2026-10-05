import { Prisma, type Category, type TransactionType } from "@/generated/prisma";
import type { DbClient } from "@capital/server/lib/prisma";
import { LedgerError } from "@capital/server/modules/ledger/lib/errors";
import { inTransaction, recordMutation, snapshot, type MutationRecordInput } from "@capital/server/modules/ledger/services/mutations";

export interface CategoryInput {
  name: string;
  type: TransactionType;
  color?: string | null;
  icon?: string | null;
}

export interface CategoryPatch {
  name?: string;
  type?: TransactionType;
  color?: string | null;
  icon?: string | null;
  isArchived?: boolean;
}

export async function listCategories(userId: string, db: DbClient, opts: { type?: TransactionType; includeArchived?: boolean } = {}) {
  return db.category.findMany({
    where: { userId, ...(opts.type && { type: opts.type }), ...(!opts.includeArchived && { isArchived: false }) },
    orderBy: [{ type: "asc" }, { name: "asc" }],
  });
}

export async function getOwnedCategory(userId: string, id: string, db: DbClient) {
  const category = await db.category.findFirst({ where: { id, userId } });
  if (!category) throw new LedgerError("Category not found or access denied", 404, { code: "category.not_found" });
  return category;
}

export async function createCategory(userId: string, input: CategoryInput, db: DbClient) {
  const name = input.name.trim();
  if (!name) throw new LedgerError("Category name is required", 422, { code: "category.name_required" });
  try {
    return await db.category.create({ data: { userId, name, type: input.type, color: input.color ?? null, icon: input.icon ?? null } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new LedgerError(`A category named '${name}' already exists for type ${input.type}`, 409, { code: "category.name_taken", params: { name, type: input.type } });
    }
    throw error;
  }
}

/** Records pointing at a category, by kind. */
export async function categoryUsage(userId: string, categoryId: string, db: DbClient) {
  const [entries, recurring, budgets, rules] = await Promise.all([
    db.ledgerEntry.count({ where: { userId, categoryId, deletedAt: null } }),
    db.recurringRule.count({ where: { userId, categoryId } }),
    db.budget.count({ where: { userId, categoryId } }),
    db.categorizationRule.count({ where: { userId, categoryId } }),
  ]);
  return { entries, recurring, budgets, rules, total: entries + recurring + budgets + rules };
}

/**
 * Rename, recolor, archive or retype. Names are a label only (records point
 * at the id), so a rename touches one row. A system category keeps its type;
 * any category keeps its type while entries use it. One undo batch.
 */
export async function updateCategory(userId: string, id: string, patch: CategoryPatch & { systemKey?: unknown }, db: DbClient) {
  return inTransaction(db, async (tx) => {
    const existing = await getOwnedCategory(userId, id, tx);
    if ("systemKey" in patch) throw new LedgerError("Cannot modify systemKey - it's a stable identifier", 422, { code: "category.system_key_immutable" });
    const name = patch.name?.trim();
    if (name && name !== existing.name) {
      const type = patch.type ?? existing.type;
      const clash = await tx.category.findFirst({ where: { userId, name, type, NOT: { id } } });
      if (clash) {
        throw new LedgerError(`A category named '${name}' already exists for type ${type}. Use merge_categories to merge '${existing.name}' into '${name}' instead.`, 409, { code: "category.name_taken", params: { name, type } });
      }
    }
    if (patch.type && patch.type !== existing.type) {
      if (existing.systemKey) {
        throw new LedgerError(`Cannot change type of system category '${existing.name}' (systemKey: ${existing.systemKey})`, 422, { code: "category.system_type_locked", params: { name: existing.name } });
      }
      const used = await tx.ledgerEntry.count({ where: { userId, categoryId: id, deletedAt: null } });
      if (used > 0) {
        throw new LedgerError(`Cannot change category type when ${used} transaction(s) use it. Transactions must all be consistent with the new type.`, 422, { code: "category.type_in_use", params: { count: used } });
      }
    }
    const updated = await tx.category.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(patch.type && { type: patch.type }),
        ...(patch.color !== undefined && { color: patch.color }),
        ...(patch.icon !== undefined && { icon: patch.icon }),
        ...(patch.isArchived !== undefined && { isArchived: patch.isArchived }),
      },
    });
    const batchId = await recordMutation(tx, userId, "update", existing.name, [{ model: "Category", recordId: id, before: snapshot(existing), after: snapshot(updated) }]);
    return { ...updated, batchId };
  });
}

function assertRemovable(c: Category, verb: "delete" | "merge from") {
  if (c.systemKey) {
    throw new LedgerError(
      verb === "delete"
        ? `Cannot delete system category '${c.name}' (systemKey: ${c.systemKey}). System categories are required by the app. Use merge_categories to consolidate.`
        : `Cannot merge from system category '${c.name}' (systemKey: ${c.systemKey}). System categories are required by the app and must not be deleted.`,
      422,
      { code: "category.system_protected", params: { name: c.name } }
    );
  }
  if (c.isDefault) {
    throw new LedgerError(verb === "delete" ? "Cannot delete default categories" : "Cannot merge from a default category", 422, { code: "category.default_protected", params: { name: c.name } });
  }
  if (c.isSystem) {
    throw new LedgerError(verb === "delete" ? "Cannot delete system categories" : "Cannot merge from a system category", 422, { code: "category.system_protected", params: { name: c.name } });
  }
}

/**
 * Point everything at `from` to `to`, recording each row it moves (and the
 * duplicate rules it drops) so undo points them back. Budgets clash on
 * (entity, category, period, effectiveFrom), the budgets' unique key.
 */
async function reassign(userId: string, from: Category, to: Category, db: DbClient, records: MutationRecordInput[]) {
  const budgets = await db.budget.findMany({ where: { userId, categoryId: from.id } });
  const conflicts: string[] = [];
  for (const b of budgets) {
    const clash = await db.budget.findFirst({ where: { userId, categoryId: to.id, entityId: b.entityId, period: b.period, effectiveFrom: b.effectiveFrom } });
    if (clash) conflicts.push(`${b.entityId ?? "all"}/${b.period}/effectiveFrom:${b.effectiveFrom.toISOString().slice(0, 10)}`);
  }
  if (conflicts.length) {
    throw new LedgerError(`Cannot reassign budgets: target category already has budgets for: ${conflicts.join(", ")}. Delete or merge those budgets first.`, 409, { code: "category.reassign_budget_clash", params: { count: conflicts.length } });
  }
  const [entries, recurring] = await Promise.all([
    db.ledgerEntry.findMany({ where: { userId, categoryId: from.id } }),
    db.recurringRule.findMany({ where: { userId, categoryId: from.id } }),
  ]);
  await Promise.all([
    db.ledgerEntry.updateMany({ where: { id: { in: entries.map((e) => e.id) } }, data: { categoryId: to.id } }),
    db.recurringRule.updateMany({ where: { id: { in: recurring.map((r) => r.id) } }, data: { categoryId: to.id } }),
    db.budget.updateMany({ where: { id: { in: budgets.map((b) => b.id) } }, data: { categoryId: to.id } }),
  ]);
  for (const e of entries) records.push({ model: "LedgerEntry", recordId: e.id, before: snapshot(e), after: snapshot({ ...e, categoryId: to.id }) });
  for (const r of recurring) records.push({ model: "RecurringRule", recordId: r.id, before: snapshot(r), after: snapshot({ ...r, categoryId: to.id }) });
  for (const b of budgets) records.push({ model: "Budget", recordId: b.id, before: snapshot(b), after: snapshot({ ...b, categoryId: to.id }) });
  // A rule for the same pattern may already exist on the target; keep that one.
  const rules = await db.categorizationRule.findMany({ where: { userId, categoryId: from.id } });
  let rulesMoved = 0;
  for (const rule of rules) {
    const dupe = await db.categorizationRule.findFirst({ where: { userId, matchType: rule.matchType, pattern: rule.pattern, NOT: { id: rule.id } } });
    if (dupe) {
      await db.categorizationRule.delete({ where: { id: rule.id } });
      records.push({ model: "CategorizationRule", recordId: rule.id, before: snapshot(rule), after: null });
    } else {
      const moved = await db.categorizationRule.update({ where: { id: rule.id }, data: { categoryId: to.id } });
      records.push({ model: "CategorizationRule", recordId: rule.id, before: snapshot(rule), after: snapshot(moved) });
      rulesMoved++;
    }
  }
  return { entries: entries.length, recurring: recurring.length, budgets: budgets.length, rules: rulesMoved };
}

/** Deletes a category (optionally moving everything to `reassignTo` first) in one undo batch that re-creates it. */
export async function deleteCategory(userId: string, id: string, reassignTo: string | undefined, db: DbClient) {
  return inTransaction(db, async (tx) => {
    const existing = await getOwnedCategory(userId, id, tx);
    assertRemovable(existing, "delete");
    if (reassignTo === id) throw new LedgerError("Cannot reassign a category to itself", 422, { code: "category.reassign_self" });
    const records: MutationRecordInput[] = [];
    if (reassignTo) {
      const target = await tx.category.findFirst({ where: { id: reassignTo, userId } });
      if (!target) throw new LedgerError("Target category not found for reassignment", 404, { code: "category.target_not_found" });
      if (target.type !== existing.type) {
        throw new LedgerError(`Cannot reassign to category of different type: ${existing.type} -> ${target.type}`, 422, { code: "category.type_mismatch", params: { from: existing.type, to: target.type } });
      }
      await reassign(userId, existing, target, tx, records);
    } else {
      const usage = await categoryUsage(userId, id, tx);
      if (usage.total > 0) {
        throw new LedgerError(
          `Cannot delete category with linked records: ${usage.entries} transaction(s), ${usage.recurring} recurring transaction(s), ${usage.budgets} budget(s), ${usage.rules} rule(s). Provide 'reassignTo' to reassign them first.`,
          409,
          { code: "category.in_use", params: { entries: usage.entries, recurring: usage.recurring, budgets: usage.budgets, rules: usage.rules } }
        );
      }
    }
    // Trashed entries keep pointing nowhere rather than blocking the delete.
    const trashed = await tx.ledgerEntry.findMany({ where: { userId, categoryId: id } });
    await tx.ledgerEntry.updateMany({ where: { id: { in: trashed.map((e) => e.id) } }, data: { categoryId: null } });
    for (const e of trashed) records.push({ model: "LedgerEntry", recordId: e.id, before: snapshot(e), after: snapshot({ ...e, categoryId: null }) });
    await tx.category.delete({ where: { id } });
    records.push({ model: "Category", recordId: id, before: snapshot(existing), after: null });
    const batchId = await recordMutation(tx, userId, "delete", existing.name, records);
    return { success: true, id, batchId };
  });
}

/** Moves everything from one category into another and deletes the source, in one undo batch that re-creates it. */
export async function mergeCategories(userId: string, fromId: string, toId: string, db: DbClient) {
  return inTransaction(db, async (tx) => {
    const from = await tx.category.findFirst({ where: { id: fromId, userId } });
    if (!from) throw new LedgerError("Source category not found or access denied", 404, { code: "category.not_found" });
    const to = await tx.category.findFirst({ where: { id: toId, userId } });
    if (!to) throw new LedgerError("Target category not found or access denied", 404, { code: "category.target_not_found" });
    if (fromId === toId) throw new LedgerError("Cannot merge a category into itself", 422, { code: "category.merge_self" });
    if (to.isArchived) throw new LedgerError(`Cannot merge into archived category '${to.name}'. Unarchive it first.`, 422, { code: "category.merge_into_archived", params: { name: to.name } });
    if (from.type !== to.type) {
      throw new LedgerError(`Cannot merge categories of different types: ${from.type} -> ${to.type}`, 422, { code: "category.type_mismatch", params: { from: from.type, to: to.type } });
    }
    assertRemovable(from, "merge from");
    const records: MutationRecordInput[] = [];
    const moved = await reassign(userId, from, to, tx, records);
    await tx.category.delete({ where: { id: fromId } });
    records.push({ model: "Category", recordId: fromId, before: snapshot(from), after: null });
    const batchId = await recordMutation(tx, userId, "merge", `${from.name} → ${to.name}`, records);
    return {
      success: true,
      fromCategory: from.name,
      toCategory: to.name,
      transactionsMoved: moved.entries,
      recurringTransactionsMoved: moved.recurring,
      budgetsMoved: moved.budgets,
      rulesMoved: moved.rules,
      batchId,
    };
  });
}

/**
 * Income/expense entries with no category, or one that is archived. With a
 * foreign key a dangling name can no longer exist; these are what a
 * categorization pass still has to fix.
 */
export async function findUncategorized(userId: string, db: DbClient, opts: { limit?: number; entityId?: string } = {}) {
  const where: Prisma.LedgerEntryWhereInput = {
    userId,
    deletedAt: null,
    transferGroupId: null,
    kind: { in: ["income", "expense"] },
    ...(opts.entityId && { entityId: opts.entityId }),
    OR: [{ categoryId: null }, { category: { isArchived: true } }],
  };
  const [total, rows] = await Promise.all([
    db.ledgerEntry.count({ where }),
    db.ledgerEntry.findMany({
      where,
      orderBy: { date: "desc" },
      take: Math.min(opts.limit ?? 100, 500),
      include: { category: { select: { name: true, isArchived: true } }, entity: { select: { name: true, kind: true } } },
    }),
  ]);
  return { total, rows };
}

export function serializeCategory(c: Category) {
  return {
    id: c.id,
    name: c.name,
    type: c.type,
    color: c.color,
    icon: c.icon,
    systemKey: c.systemKey,
    isDefault: c.isDefault,
    isSystem: c.isSystem,
    isArchived: c.isArchived,
  };
}
