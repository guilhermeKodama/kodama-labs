/**
 * One-off backfill linking existing holdings to the global Asset/AssetPrice
 * layer (F1a): for every unlinked holding with a ticker, resolveAsset()
 * finds or creates its Asset (and the brapi/Yahoo/CoinGecko source refs
 * that price it) and the holding gets assetId + priceSource="auto".
 *
 *   pnpm exec tsx --env-file=.env scripts/backfill-asset-links.ts [--dry-run] [--user <userId>]
 *
 * Idempotent: a holding with assetId already set is skipped — safe to
 * re-run. Mainly for a fresh environment or a bulk import: a holding
 * created afterwards links itself the first time someone presses
 * "Atualizar cotações" (see refreshPricesLive in update-prices.ts), since
 * createHolding/updateHolding don't call resolveAsset directly. Writes with
 * $executeRaw, never prisma.investmentHolding.update — an ordinary update
 * touches updatedAt, and portfolio-history.ts derives a removed holding's
 * removedAt from it. This backfill must never make every holding it linked
 * look like it was removed and re-added today.
 */
import { prisma } from "../src/server/lib/prisma";
import { resolveAsset, type ResolveAssetInput, type ResolveAssetResult } from "../src/server/modules/market-data/services/resolve-asset";

const DRY_RUN_ROLLBACK = Symbol("backfill-asset-links dry run rollback");

/** Runs resolveAsset for real, then rolls the transaction back — so a dry run still reports exactly what would be created/matched, without writing a single row. */
async function previewResolve(input: ResolveAssetInput): Promise<ResolveAssetResult> {
  let captured: ResolveAssetResult | undefined;
  await prisma
    .$transaction(async (tx) => {
      captured = await resolveAsset(tx, input);
      throw DRY_RUN_ROLLBACK;
    })
    .catch((error) => {
      if (error !== DRY_RUN_ROLLBACK) throw error;
    });
  return captured!;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const userFlag = args.indexOf("--user");
  const userId = userFlag >= 0 ? args[userFlag + 1] : undefined;
  if (userFlag >= 0 && !userId) throw new Error("--user needs a user id");

  const holdings = await prisma.investmentHolding.findMany({
    where: { assetId: null, ...(userId ? { account: { userId } } : {}) },
    select: { id: true, ticker: true, assetClass: true, currency: true, name: true },
    orderBy: { createdAt: "asc" },
  });

  let linked = 0;
  const byReason: Partial<Record<Exclude<ResolveAssetResult, { linked: true }>["reason"], number>> = {};
  for (const h of holdings) {
    const result = dryRun
      ? await previewResolve({ ticker: h.ticker, assetClass: h.assetClass, currency: h.currency })
      : await resolveAsset(prisma, { ticker: h.ticker, assetClass: h.assetClass, currency: h.currency });

    if (result.linked) {
      linked++;
      console.log(`${dryRun ? "would link" : "linked"} ${h.id} ${h.name} (${h.ticker ?? "sem ticker"}) -> asset ${result.assetId}`);
      if (!dryRun) {
        await prisma.$executeRaw`UPDATE investment_holdings SET "assetId" = ${result.assetId}, "priceSource" = 'auto' WHERE id = ${h.id}`;
      }
    } else {
      byReason[result.reason] = (byReason[result.reason] ?? 0) + 1;
    }
  }

  console.log(`holdings: ${holdings.length} checked, ${linked} ${dryRun ? "to link" : "linked"}${dryRun ? " (dry run, nothing written)" : ""}`);
  for (const [reason, count] of Object.entries(byReason)) console.log(`  ${count} ${reason}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
