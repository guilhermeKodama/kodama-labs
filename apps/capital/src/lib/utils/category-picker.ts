import type { TransactionType } from "@/types";

/**
 * Names offered in a category picker. Archived rows are omitted.
 * When the record already uses an archived name, that name stays in the
 * list so the select does not blank. If the user has no categories of this
 * type yet, fall back to the seeded defaults.
 */
export function pickerCategoryNames(
  categories: Array<{ name: string; type: string; isArchived?: boolean }>,
  type: TransactionType,
  current: string | null | undefined,
  fallback: string[]
): string[] {
  const ofType = categories.filter((category) => category.type === type);
  const visible = ofType.filter((category) => !category.isArchived).map((category) => category.name);
  const base = ofType.length > 0 ? visible : fallback;
  if (current && !base.includes(current)) return [current, ...base];
  return base;
}
