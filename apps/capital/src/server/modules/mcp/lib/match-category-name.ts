/**
 * Minimal stand-in until PR #64's category-validation.ts lands.
 * Exact name, then case-insensitive canonical name. Unknown stays unmatched.
 * The rebase replaces this file with that helper.
 */
export function matchCategoryName(
  name: string,
  categories: { name: string }[]
): string | null {
  const exact = categories.find((category) => category.name === name);
  if (exact) return exact.name;
  const lower = name.toLowerCase();
  const match = categories.find((category) => category.name.toLowerCase() === lower);
  return match?.name ?? null;
}
