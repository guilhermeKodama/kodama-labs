import type { DbClient } from "@capital/server/lib/prisma";
import type { CategorizationRule } from "@/generated/prisma";
import { normalizeDescription } from "@capital/server/modules/bank-statements/utils";
import { LedgerError, notFound } from "../lib/errors";
import { inTransaction, recordMutation, snapshot, type MutationRecordInput } from "./mutations";

export const RULE_MATCH_TYPES = ["equals", "contains", "regex"] as const;
export type RuleMatchType = (typeof RULE_MATCH_TYPES)[number];

function matches(rule: Pick<CategorizationRule, "matchType" | "pattern">, description: string): boolean {
  switch (rule.matchType) {
    case "equals":
      return normalizeDescription(description) === rule.pattern;
    case "contains":
      return description.toLowerCase().includes(rule.pattern.toLowerCase());
    case "regex":
      try {
        return new RegExp(rule.pattern, "i").test(description);
      } catch {
        return false;
      }
    default:
      return false;
  }
}

const PRECEDENCE: Record<string, number> = { equals: 0, contains: 1, regex: 2 };

/** Loads a user's rules once and matches descriptions against them (equals > contains > regex, entity-specific first). */
export async function loadRuleMatcher(userId: string, db: DbClient) {
  const rules = await db.categorizationRule.findMany({
    where: { userId, category: { isArchived: false } },
  });
  rules.sort((a, b) => (PRECEDENCE[a.matchType] ?? 9) - (PRECEDENCE[b.matchType] ?? 9) || Number(!!b.entityId) - Number(!!a.entityId));
  return {
    match(description: string, entityId?: string | null): CategorizationRule | null {
      for (const rule of rules) {
        if (rule.entityId && entityId && rule.entityId !== entityId) continue;
        if (matches(rule, description)) return rule;
      }
      return null;
    },
  };
}

export async function recordRuleHits(ruleIds: string[], db: DbClient) {
  const counts = new Map<string, number>();
  for (const id of ruleIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  for (const [id, n] of counts) {
    await db.categorizationRule.update({ where: { id }, data: { hitCount: { increment: n }, lastHitAt: new Date() } });
  }
}

/**
 * Learn (or move) an exact-description rule. Used by manual recategorization
 * and bulk edits; with `collect`, a rule created or moved joins the caller's
 * undo batch.
 */
export async function learnRule(
  userId: string,
  description: string,
  categoryId: string,
  source: "manual" | "ai" | "bulk",
  db: DbClient,
  opts: { collect?: MutationRecordInput[] } = {}
) {
  const pattern = normalizeDescription(description);
  if (!pattern) return null;
  const where = { userId_matchType_pattern: { userId, matchType: "equals", pattern } };
  const before = opts.collect ? await db.categorizationRule.findUnique({ where }) : null;
  const rule = await db.categorizationRule.upsert({ where, create: { userId, matchType: "equals", pattern, categoryId, source }, update: { categoryId, source } });
  if (opts.collect && (before?.categoryId !== rule.categoryId || before?.source !== rule.source)) {
    opts.collect.push({ model: "CategorizationRule", recordId: rule.id, before: snapshot(before), after: snapshot(rule) });
  }
  return rule;
}

export interface RuleInput {
  matchType: RuleMatchType;
  pattern: string;
  categoryId: string;
  entityId?: string | null;
}

/** The pattern as stored: "equals" patterns normalized like the descriptions they are compared with, regexes checked. */
function rulePattern(matchType: string, pattern: string) {
  if (matchType === "regex") {
    try {
      new RegExp(pattern);
    } catch {
      throw new LedgerError("Invalid regular expression", 422, { code: "rule.invalid_regex" });
    }
  }
  return matchType === "equals" ? normalizeDescription(pattern) : pattern;
}

/** Each write below is one undo batch (batchId). */
export async function createRule(userId: string, input: RuleInput, db: DbClient) {
  await assertCategory(userId, input.categoryId, db);
  if (input.entityId) await assertEntity(userId, input.entityId, db);
  const pattern = rulePattern(input.matchType, input.pattern);
  return inTransaction(db, async (tx) => {
    const rule = await tx.categorizationRule.create({
      data: { userId, matchType: input.matchType, pattern, categoryId: input.categoryId, entityId: input.entityId ?? null, source: "manual" },
    });
    const batchId = await recordMutation(tx, userId, "create", rule.pattern, [{ model: "CategorizationRule", recordId: rule.id, before: null, after: snapshot(rule) }]);
    return { ...rule, batchId };
  });
}

export async function updateRule(userId: string, ruleId: string, patch: Partial<RuleInput>, db: DbClient) {
  return inTransaction(db, async (tx) => {
    const rule = await tx.categorizationRule.findFirst({ where: { id: ruleId, userId } });
    if (!rule) throw new LedgerError("Rule not found", 404, { code: "rule.not_found" });
    if (patch.categoryId) await assertCategory(userId, patch.categoryId, tx);
    if (patch.entityId) await assertEntity(userId, patch.entityId, tx);
    const matchType = patch.matchType ?? rule.matchType;
    const pattern = patch.pattern !== undefined || patch.matchType !== undefined ? rulePattern(matchType, patch.pattern ?? rule.pattern) : undefined;
    const updated = await tx.categorizationRule.update({ where: { id: ruleId }, data: { ...patch, ...(pattern !== undefined && { pattern }) } });
    const batchId = await recordMutation(tx, userId, "update", updated.pattern, [{ model: "CategorizationRule", recordId: rule.id, before: snapshot(rule), after: snapshot(updated) }]);
    return { ...updated, batchId };
  });
}

/**
 * Deletes a rule outright; undo re-creates it under its id. The entries it
 * categorized keep their category, but no longer name the rule (they are
 * not part of the batch, so undoing older changes to them stays possible).
 */
export async function deleteRule(userId: string, ruleId: string, db: DbClient) {
  return inTransaction(db, async (tx) => {
    const rule = await tx.categorizationRule.findFirst({ where: { id: ruleId, userId } });
    if (!rule) throw new LedgerError("Rule not found", 404, { code: "rule.not_found" });
    await tx.categorizationRule.delete({ where: { id: rule.id } });
    const batchId = await recordMutation(tx, userId, "delete", rule.pattern, [{ model: "CategorizationRule", recordId: rule.id, before: snapshot(rule), after: null }]);
    return { batchId };
  });
}

async function assertCategory(userId: string, categoryId: string, db: DbClient) {
  const category = await db.category.findFirst({ where: { id: categoryId, userId } });
  if (!category) throw new LedgerError("Category not found", 404, { code: "category.not_found" });
  if (category.isArchived) throw new LedgerError(`Category "${category.name}" is archived`, 422, { code: "category.archived", params: { name: category.name } });
  return category;
}

/** A rule may be limited to one of the user's own entities only. */
async function assertEntity(userId: string, entityId: string, db: DbClient) {
  if (!(await db.entity.count({ where: { id: entityId, userId } }))) throw notFound("Entity", "entity.not_found");
}

/** Which rule (if any) would categorize `description`. */
export async function testRules(userId: string, description: string, db: DbClient) {
  const matcher = await loadRuleMatcher(userId, db);
  const rule = matcher.match(description);
  if (!rule) return { rule: null, category: null };
  const category = await db.category.findUnique({ where: { id: rule.categoryId } });
  return { rule, category };
}
