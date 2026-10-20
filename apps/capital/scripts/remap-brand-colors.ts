/**
 * One-off: moves the colors stored on entities, accounts and categories
 * from the old Tailwind swatches to the Cerne ones (src/lib/settings/
 * palette.ts keeps the same order, so each old color has one new color).
 * Values that are not an old swatch are left alone.
 *
 *   pnpm exec tsx --env-file=.env scripts/remap-brand-colors.ts --dry-run [--user <userId>]
 *   pnpm exec tsx --env-file=.env scripts/remap-brand-colors.ts [--user <userId>] [--backup <file>]
 *   pnpm exec tsx --env-file=.env scripts/remap-brand-colors.ts --reverse <backup file>
 *
 * Applying writes a JSON backup of every row it changes (table, id, old
 * color) before touching anything, then counts again: no row may still
 * hold an old swatch. --reverse puts each backed-up row back, but only if
 * it still holds the color this script gave it (a later change by the user
 * wins). In production, run it inside the web container, where the
 * database guard allows it.
 */
import fs from "node:fs";
import { prisma } from "../src/server/lib/prisma";
import { PALETTE } from "../src/lib/settings/palette";

/** The Tailwind swatches the palette had, in the same order as PALETTE now. */
const OLD_SWATCHES = ["#737373", "#7c3aed", "#16a34a", "#ca8a04", "#0891b2", "#db2777", "#2563eb", "#ea580c", "#dc2626"] as const;
const NEW_FOR_OLD = new Map<string, string>(OLD_SWATCHES.map((hex, i) => [hex, PALETTE[i]!.hex]));

type Table = "entity" | "account" | "category";
interface Change {
  table: Table;
  id: string;
  userId: string;
  from: string;
  to: string;
}

async function planChanges(userId: string | undefined): Promise<Change[]> {
  const where = { color: { not: null }, ...(userId ? { userId } : {}) };
  const [entities, accounts, categories] = await Promise.all([
    prisma.entity.findMany({ where, select: { id: true, userId: true, color: true } }),
    prisma.account.findMany({ where, select: { id: true, userId: true, color: true } }),
    prisma.category.findMany({ where, select: { id: true, userId: true, color: true } }),
  ]);
  const changes: Change[] = [];
  for (const [table, rows] of [["entity", entities], ["account", accounts], ["category", categories]] as const) {
    for (const row of rows) {
      const to = NEW_FOR_OLD.get(row.color!.trim().toLowerCase());
      if (to) changes.push({ table, id: row.id, userId: row.userId, from: row.color!, to });
    }
  }
  return changes;
}

async function setColor(table: Table, id: string, color: string, onlyIf?: string) {
  const where = { id, ...(onlyIf ? { color: onlyIf } : {}) };
  const data = { color };
  if (table === "entity") return (await prisma.entity.updateMany({ where, data })).count;
  if (table === "account") return (await prisma.account.updateMany({ where, data })).count;
  return (await prisma.category.updateMany({ where, data })).count;
}

function summary(changes: Change[]): string {
  const by = (table: Table) => changes.filter((c) => c.table === table).length;
  return `${by("entity")} entities, ${by("account")} accounts, ${by("category")} categories`;
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (name: string) => {
    const i = args.indexOf(name);
    if (i < 0) return undefined;
    const value = args[i + 1];
    if (!value || value.startsWith("--")) throw new Error(`${name} needs a value`);
    return value;
  };

  const reverse = flag("--reverse");
  if (reverse) {
    const backup = JSON.parse(fs.readFileSync(reverse, "utf8")) as Change[];
    let restored = 0;
    for (const change of backup) restored += await setColor(change.table, change.id, change.from, change.to);
    console.log(`restored ${restored} of ${backup.length} rows from ${reverse} (rows changed since were left alone)`);
    return;
  }

  const userId = flag("--user");
  const changes = await planChanges(userId);
  for (const c of changes) console.log(`${c.table} ${c.id} (user ${c.userId}): ${c.from} -> ${c.to}`);
  if (args.includes("--dry-run")) {
    console.log(`dry run: would remap ${changes.length} colors (${summary(changes)})`);
    return;
  }

  const backupFile = flag("--backup") ?? `remap-brand-colors-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  fs.writeFileSync(backupFile, JSON.stringify(changes, null, 2));
  console.log(`backup of ${changes.length} rows written to ${backupFile}`);
  let written = 0;
  for (const c of changes) written += await setColor(c.table, c.id, c.to, c.from);
  const left = await planChanges(userId);
  console.log(`remapped ${written} colors (${summary(changes)}); ${left.length} old swatches left`);
  if (left.length > 0) {
    process.exitCode = 1;
    console.error("verification failed: some rows still hold an old swatch");
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
