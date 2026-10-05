import type { DbClient } from "@capital/server/lib/prisma";
import type { CategorizationRule } from "@/generated/prisma";
import { normalizeDescription } from "@capital/server/modules/bank-statements/utils";
import { LedgerError } from "../lib/errors";

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

/** Learn (or move) an exact-description rule. Used by manual recategorization and bulk edits. */
export async function learnRule(
  userId: string,
  description: string,
  categoryId: string,
  source: "manual" | "ai" | "bulk",
  db: DbClient
) {
  const pattern = normalizeDescription(description);
  if (!pattern) return null;
  return db.categorizationRule.upsert({
    where: { userId_matchType_pattern: { userId, matchType: "equals", pattern } },
    create: { userId, matchType: "equals", pattern, categoryId, source },
    update: { categoryId, source },
  });
}

export interface RuleInput {
  matchType: RuleMatchType;
  pattern: string;
  categoryId: string;
  entityId?: string | null;
}

export async function createRule(userId: string, input: RuleInput, db: DbClient) {
  await assertCategory(userId, input.categoryId, db);
  if (input.matchType === "regex") {
    try {
      new RegExp(input.pattern);
    } catch {
      throw new LedgerError("Invalid regular expression", 422, { code: "rule.invalid_regex" });
    }
  }
  const pattern = input.matchType === "equals" ? normalizeDescription(input.pattern) : input.pattern;
  return db.categorizationRule.create({
    data: { userId, matchType: input.matchType, pattern, categoryId: input.categoryId, entityId: input.entityId ?? null, source: "manual" },
  });
}

export async function updateRule(userId: string, ruleId: string, patch: Partial<RuleInput>, db: DbClient) {
  const rule = await db.categorizationRule.findFirst({ where: { id: ruleId, userId } });
  if (!rule) throw new LedgerError("Rule not found", 404, { code: "rule.not_found" });
  if (patch.categoryId) await assertCategory(userId, patch.categoryId, db);
  return db.categorizationRule.update({ where: { id: ruleId }, data: patch });
}

export async function deleteRule(userId: string, ruleId: string, db: DbClient) {
  const { count } = await db.categorizationRule.deleteMany({ where: { id: ruleId, userId } });
  if (!count) throw new LedgerError("Rule not found", 404, { code: "rule.not_found" });
}

async function assertCategory(userId: string, categoryId: string, db: DbClient) {
  const category = await db.category.findFirst({ where: { id: categoryId, userId } });
  if (!category) throw new LedgerError("Category not found", 404, { code: "category.not_found" });
  if (category.isArchived) throw new LedgerError(`Category "${category.name}" is archived`, 422, { code: "category.archived", params: { name: category.name } });
  return category;
}

/** Which rule (if any) would categorize `description`. */
export async function testRules(userId: string, description: string, db: DbClient) {
  const matcher = await loadRuleMatcher(userId, db);
  const rule = matcher.match(description);
  if (!rule) return { rule: null, category: null };
  const category = await db.category.findUnique({ where: { id: rule.categoryId } });
  return { rule, category };
}
