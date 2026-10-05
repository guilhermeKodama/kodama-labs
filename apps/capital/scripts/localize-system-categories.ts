/**
 * Renames system categories that still carry the catalog's English name
 * ("Groceries") to their name in the owner's locale ("Mercado"), matching
 * by systemKey. Categories the user renamed are left alone, and so is one
 * whose localized name another category of the same type already uses (it
 * is listed as a conflict). Idempotent; --dry-run only prints the plan.
 *
 *   pnpm tsx scripts/localize-system-categories.ts [--dry-run] [--user <userId>]
 */
import { prisma } from "../src/server/lib/prisma";
import { localizeSystemCategories } from "../src/server/modules/categories/lib/localize-system-categories";

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const userFlag = args.indexOf("--user");
  const userId = userFlag >= 0 ? args[userFlag + 1] : undefined;
  if (userFlag >= 0 && !userId) throw new Error("--user needs a user id");

  const result = await localizeSystemCategories(prisma, { userId, dryRun });
  for (const r of result.renamed) console.log(`${dryRun ? "would rename" : "renamed"} ${r.userId} ${r.id}: ${r.from} -> ${r.to}`);
  for (const c of result.conflicts) console.log(`kept ${c.userId} ${c.id}: ${c.name} (${c.wanted} is taken)`);
  console.log(`${result.renamed.length} ${dryRun ? "to rename" : "renamed"}, ${result.conflicts.length} kept because of a name conflict`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
