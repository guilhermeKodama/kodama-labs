/**
 * The editor of a conta fixa (a recurring rule) opened from Contas fixas:
 * amount, frequency, auto or reminder, next due date, end date and pause.
 * Only what changed is sent (PATCH /v2/recurring/{id}), so switching a
 * rule to auto books the occurrences already due and nothing else moves.
 */

export const RULE_FREQUENCIES = ["daily", "weekly", "monthly", "yearly"] as const;
export type RuleFrequency = (typeof RULE_FREQUENCIES)[number];

export interface RuleLike {
  amount: number;
  frequency: string;
  autoGenerate: boolean;
  nextDueDate: string;
  endDate: string | null;
  isActive: boolean;
}

export interface RuleFormState {
  amount: string;
  frequency: RuleFrequency;
  autoGenerate: boolean;
  nextDueDate: string;
  /** "" = no end date. */
  endDate: string;
  isActive: boolean;
}

export interface RulePatch {
  amount?: number;
  frequency?: RuleFrequency;
  autoGenerate?: boolean;
  nextDueDate?: string;
  endDate?: string | null;
  isActive?: boolean;
}

export type RuleField = "amount" | "nextDueDate" | "endDate";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

const isDay = (value: string) => DAY.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`));

export const asFrequency = (value: string): RuleFrequency => ((RULE_FREQUENCIES as readonly string[]).includes(value) ? (value as RuleFrequency) : "monthly");

/** The form of a rule; `formatAmount` writes the amount in the user's number format. */
export function ruleForm(rule: RuleLike, formatAmount: (value: number) => string): RuleFormState {
  return {
    amount: formatAmount(rule.amount),
    frequency: asFrequency(rule.frequency),
    autoGenerate: rule.autoGenerate,
    nextDueDate: rule.nextDueDate.slice(0, 10),
    endDate: rule.endDate?.slice(0, 10) ?? "",
    isActive: rule.isActive,
  };
}

/** The changed fields of a form, or the fields that are invalid (a positive amount, real dates). */
export function rulePatch(form: RuleFormState, rule: RuleLike, parseAmount: (text: string) => number): { patch: RulePatch; errors: Set<RuleField> } {
  const errors = new Set<RuleField>();
  const patch: RulePatch = {};
  const amount = parseAmount(form.amount);
  if (!(amount > 0)) errors.add("amount");
  else if (Math.abs(amount - rule.amount) >= 0.005) patch.amount = amount;
  if (!isDay(form.nextDueDate)) errors.add("nextDueDate");
  else if (form.nextDueDate !== rule.nextDueDate.slice(0, 10)) patch.nextDueDate = form.nextDueDate;
  const endDate = form.endDate.trim();
  if (endDate && !isDay(endDate)) errors.add("endDate");
  else if ((endDate || null) !== (rule.endDate?.slice(0, 10) ?? null)) patch.endDate = endDate || null;
  if (form.frequency !== rule.frequency) patch.frequency = form.frequency;
  if (form.autoGenerate !== rule.autoGenerate) patch.autoGenerate = form.autoGenerate;
  if (form.isActive !== rule.isActive) patch.isActive = form.isActive;
  return { patch, errors };
}

/** Frequencies the Frequência select offers: the mockup's three, plus the rule's own when it is daily. */
export function frequencyOptions(current: string): RuleFrequency[] {
  return current === "daily" ? ["daily", "weekly", "monthly", "yearly"] : ["weekly", "monthly", "yearly"];
}

/** "Ver todas": active rules by next due date, then paused ones. */
export function groupRules<R extends { isActive: boolean; nextDueDate: string; description: string }>(rules: readonly R[]): { active: R[]; paused: R[] } {
  const byDue = (a: R, b: R) => a.nextDueDate.localeCompare(b.nextDueDate) || a.description.localeCompare(b.description, "pt-BR");
  return { active: rules.filter((r) => r.isActive).sort(byDue), paused: rules.filter((r) => !r.isActive).sort(byDue) };
}
