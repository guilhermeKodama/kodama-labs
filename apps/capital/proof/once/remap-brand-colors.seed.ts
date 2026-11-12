/**
 * Puts an old Tailwind swatch back on one of the proof user's categories,
 * the state production is in before scripts/remap-brand-colors.ts runs.
 *
 *   pnpm exec tsx proof/once/remap-brand-colors.seed.ts <category> <hex>
 */
import { prisma } from "../../src/server/lib/prisma";

async function main() {
  const [name, hex] = process.argv.slice(2);
  if (!name || !hex) throw new Error("usage: <category> <hex>");
  const email = process.env.PROOF_DEMO_EMAIL;
  if (!email) throw new Error("PROOF_DEMO_EMAIL is not set");
  const { count } = await prisma.category.updateMany({ where: { name, user: { email } }, data: { color: hex } });
  console.log(`${name} of ${email}: color ${hex} (${count} row)`);
  if (count !== 1) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
