/**
 * Fast drain script — runs processing modules in a tight loop
 * until the backlog is cleared. No 5-minute cron waits.
 *
 * Usage: cd apps/sentinel && pnpm exec tsx scripts/drain-backlog.ts
 */

import { prisma } from "../src/server/lib/prisma";
import { processProcurements } from "../src/server/modules/pipeline/processing/process-procurements";
import { processContracts } from "../src/server/modules/pipeline/processing/process-contracts";
import { processItems } from "../src/server/modules/pipeline/processing/process-items";
import { processEntities } from "../src/server/modules/pipeline/processing/process-entities";
import { linkData } from "../src/server/modules/pipeline/processing/link-data";
import { processPoliticians } from "../src/server/modules/pipeline/processing/process-politicians";
import { processDonations } from "../src/server/modules/pipeline/processing/process-donations";
import { processAssets } from "../src/server/modules/pipeline/processing/process-assets";
import { processServidores } from "../src/server/modules/pipeline/processing/process-servidores";

const MAX_ITERATIONS = 500;
const IDLE_THRESHOLD = 50; // stop if fewer than this many records processed in a cycle

interface CycleResult {
  name: string;
  recordsIn: number;
  recordsOut: number;
}

async function runCycle(): Promise<CycleResult[]> {
  const modules = [
    { name: "politicians", fn: processPoliticians },
    { name: "assets", fn: processAssets },
    { name: "procurements", fn: processProcurements },
    { name: "contracts", fn: processContracts },
    { name: "donations", fn: processDonations },
    { name: "items", fn: processItems },
    { name: "entities", fn: processEntities },
    { name: "linking", fn: linkData },
    { name: "servidores", fn: processServidores },
  ];

  const results = await Promise.allSettled(modules.map((m) => m.fn()));

  return results.map((r, i) => {
    if (r.status === "fulfilled" && r.value.success && r.value.result) {
      return {
        name: modules[i].name,
        recordsIn: r.value.result.recordsIn,
        recordsOut: r.value.result.recordsOut,
      };
    }
    const err = r.status === "rejected" ? r.reason : r.value.error;
    console.error(`  [${modules[i].name}] ERROR: ${err}`);
    return { name: modules[i].name, recordsIn: 0, recordsOut: 0 };
  });
}

async function getPendingCount(): Promise<number> {
  const result = await prisma.$queryRawUnsafe<{ cnt: bigint }[]>(
    `SELECT COUNT(*) as cnt FROM raw_records WHERE "processedAt" IS NULL AND "processingError" IS NULL`
  );
  return Number(result[0].cnt);
}

async function main() {
  console.log("=== Sentinel Backlog Drain ===\n");

  const startPending = await getPendingCount();
  console.log(`Starting backlog: ${startPending.toLocaleString()} records\n`);

  const startTime = Date.now();
  let totalProcessed = 0;

  for (let i = 1; i <= MAX_ITERATIONS; i++) {
    const cycleStart = Date.now();
    const results = await runCycle();
    const cycleDuration = ((Date.now() - cycleStart) / 1000).toFixed(1);

    const cycleIn = results.reduce((s, r) => s + r.recordsIn, 0);
    const cycleOut = results.reduce((s, r) => s + r.recordsOut, 0);
    totalProcessed += cycleOut;

    const pending = await getPendingCount();
    const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    const rate = totalProcessed / ((Date.now() - startTime) / 1000 / 60);

    const moduleSummary = results
      .filter((r) => r.recordsIn > 0)
      .map((r) => `${r.name}:${r.recordsOut}/${r.recordsIn}`)
      .join(" ");

    console.log(
      `[${i}] ${cycleDuration}s | in:${cycleIn} out:${cycleOut} | pending:${pending.toLocaleString()} | ${elapsed}min elapsed | ${Math.round(rate)}/min | ${moduleSummary}`
    );

    if (cycleIn < IDLE_THRESHOLD) {
      console.log(`\nBacklog drained (cycle read only ${cycleIn} records). Done!`);
      break;
    }

    if (i === MAX_ITERATIONS) {
      console.log(`\nReached max iterations (${MAX_ITERATIONS}).`);
    }
  }

  const finalPending = await getPendingCount();
  const totalTime = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

  console.log(`\n=== Summary ===`);
  console.log(`Started: ${startPending.toLocaleString()} pending`);
  console.log(`Final:   ${finalPending.toLocaleString()} pending`);
  console.log(`Processed: ${totalProcessed.toLocaleString()} records in ${totalTime} minutes`);
  console.log(`Rate: ${Math.round(totalProcessed / (parseFloat(totalTime) || 1))}/min`);

  await prisma.$disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
