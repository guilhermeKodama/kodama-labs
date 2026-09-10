import { prisma } from "../server/lib/prisma";
async function main() {
  const id = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT inet_server_addr()::text addr, pg_postmaster_start_time()::text started`);
  console.log("servidor:", JSON.stringify(id[0]));
  const p = await prisma.searchProfile.findFirstOrThrow({ where: { isActive: true }, orderBy: { version: "desc" } });
  console.log("perfil ativo: v" + p.version, "|", p.label);
  console.log("\navoidStack (" + p.avoidStack.length + "):");
  p.avoidStack.forEach((s) => console.log("  - " + s));
  console.log("\nexcludedCompanies (" + p.excludedCompanies.length + "):");
  p.excludedCompanies.forEach((s) => console.log("  - " + s));
  console.log("\ndoNotWant (" + p.doNotWant.length + "):");
  p.doNotWant.forEach((s) => console.log("  - " + s.slice(0, 95)));
  const pend = await prisma.profileRuleProposal.groupBy({ by: ["status"], _count: true });
  console.log("\npropostas:", JSON.stringify(pend));
}
main().catch((e) => { console.error(String(e).slice(0, 300)); process.exitCode = 1; }).finally(() => prisma.$disconnect());
