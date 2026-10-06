import type { DbClient } from "@capital/server/lib/prisma";
import { Prisma } from "@/generated/prisma";
import type { CategorizationRule } from "@/generated/prisma";
import { categorizeStatementTransactions } from "@capital/server/lib/claude";
import { STATEMENT_LABEL_KEYS } from "@capital/server/lib/category-prompt";
import { normalizeDescription } from "@capital/server/modules/bank-statements/utils";
import { getSystemCategory, getSystemCategoryNames } from "@capital/server/modules/categories/lib/system-categories";
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

/**
 * Which rule (if any) would categorize `description`, matched the way
 * createEntry matches it: with `entityId`, rules limited to another entity
 * are skipped. `hitCount` is how often the rule was used ("usada 23×").
 */
export async function testRules(userId: string, description: string, db: DbClient, opts: { entityId?: string | null } = {}) {
  const matcher = await loadRuleMatcher(userId, db);
  const rule = matcher.match(description, opts.entityId ?? null);
  if (!rule) return { rule: null, category: null, hitCount: 0 };
  const category = await db.category.findUnique({ where: { id: rule.categoryId } });
  return { rule, category, hitCount: rule.hitCount };
}

// ---------------------------------------------------------------------------
// Category suggestion
// ---------------------------------------------------------------------------

export interface SuggestInput {
  description: string;
  entityId?: string | null;
  /** The entry's kind: history and AI only suggest categories of this type. Default expense. */
  kind?: "income" | "expense";
  /** Ask Claude when neither a rule nor the history knows the description. Off by default (it costs a call). */
  ai?: boolean;
}

/** One-row categorizer (the statement prompt's signature); tests inject a stub. */
export type SuggestCategorizer = (
  rows: { index: number; description: string; amount: number }[],
  categories: string[],
  type: "income" | "expense",
  fallback: string,
  labels: Record<string, string>
) => Promise<{ index: number; category: string }[]>;

type SuggestedCategory = { id: string; name: string; type: string };

export interface CategorySuggestion {
  /** rule: a categorization rule matches; history: past entries with this description; ai: Claude; null: nothing to suggest. */
  source: "rule" | "history" | "ai" | null;
  categoryId: string | null;
  category: SuggestedCategory | null;
  rule: { id: string; pattern: string; matchType: string; hitCount: number } | null;
  /** history: how many past entries with this description used the category. */
  count: number;
}

const NONE: CategorySuggestion = { source: null, categoryId: null, category: null, rule: null, count: 0 };

/** "Uber (3/10)" and "uber" are the same purchase for the history. */
const INSTALLMENT_SUFFIX = String.raw`\s*\(\d+/\d+\)\s*$`;
const historyKey = (description: string) => normalizeDescription(description.replace(new RegExp(INSTALLMENT_SUFFIX), ""));

/**
 * The most used live category of past entries with the same normalized
 * description (installment suffix ignored): the entity's own entries first,
 * then any entity's. Archived categories never come back.
 */
async function suggestFromHistory(userId: string, description: string, kind: "income" | "expense", entityId: string | null, db: DbClient) {
  const key = historyKey(description);
  if (!key) return null;
  const top = async (entity: string | null) => {
    const rows = await db.$queryRaw<{ categoryId: string; n: number }[]>`
      SELECT le."categoryId", count(*)::int AS n
      FROM ledger_entries le JOIN categories c ON c.id = le."categoryId"
      WHERE le."userId" = ${userId} AND le."deletedAt" IS NULL AND le.kind::text = ${kind}
        AND c."isArchived" = false AND c.type::text = ${kind}
        AND lower(btrim(regexp_replace(le.description, ${INSTALLMENT_SUFFIX}, ''))) = ${key}
        ${entity ? Prisma.sql`AND le."entityId" = ${entity}` : Prisma.empty}
      GROUP BY le."categoryId"
      ORDER BY n DESC, max(le.date) DESC
      LIMIT 1`;
    return rows[0] ?? null;
  };
  return (entityId ? await top(entityId) : null) ?? (await top(null));
}

async function suggestFromAi(userId: string, description: string, kind: "income" | "expense", db: DbClient, categorize?: SuggestCategorizer) {
  if (!categorize && !process.env.ANTHROPIC_API_KEY) return null;
  const run = categorize ?? categorizeStatementTransactions;
  const fallback = await getSystemCategory(userId, kind === "income" ? "other_income" : "other_system", db);
  const categories = await db.category.findMany({ where: { userId, type: kind, isArchived: false }, select: { id: true, name: true, type: true } });
  const labels = await getSystemCategoryNames(userId, STATEMENT_LABEL_KEYS, db);
  const names = [...new Set([...categories.map((c) => c.name), fallback.name])];
  const [answer] = await run([{ index: 0, description, amount: 0 }], names, kind, fallback.name, labels);
  const category = answer && answer.category !== fallback.name ? categories.find((c) => c.name === answer.category) : undefined;
  return category ?? null;
}

/**
 * The category to suggest while the user types a description: a matching
 * rule, else what past entries with this description used, else (only with
 * `ai`, and an API key) Claude's pick among the user's categories.
 */
export async function suggestCategory(userId: string, input: SuggestInput, db: DbClient, deps: { categorize?: SuggestCategorizer } = {}): Promise<CategorySuggestion> {
  const description = input.description.trim();
  if (!description) return NONE;
  const kind = input.kind ?? "expense";
  if (input.entityId) await assertEntity(userId, input.entityId, db);

  const tested = await testRules(userId, description, db, { entityId: input.entityId });
  if (tested.rule && tested.category && !tested.category.isArchived) {
    const { rule, category } = tested;
    return {
      source: "rule",
      categoryId: category.id,
      category: { id: category.id, name: category.name, type: category.type },
      rule: { id: rule.id, pattern: rule.pattern, matchType: rule.matchType, hitCount: rule.hitCount },
      count: 0,
    };
  }

  const past = await suggestFromHistory(userId, description, kind, input.entityId ?? null, db);
  if (past) {
    const category = await db.category.findUniqueOrThrow({ where: { id: past.categoryId }, select: { id: true, name: true, type: true } });
    return { source: "history", categoryId: category.id, category, rule: null, count: past.n };
  }

  if (input.ai) {
    const category = await suggestFromAi(userId, description, kind, db, deps.categorize);
    if (category) return { source: "ai", categoryId: category.id, category, rule: null, count: 0 };
  }
  return NONE;
}
