import { clearMaintenance, connectKuma, startMaintenance } from "./kuma.js";

async function main(): Promise<void> {
  const command = process.argv[2];
  const session = await connectKuma();
  try {
    if (command === "start") {
      const minutes = Number(process.argv[3] ?? "30");
      await startMaintenance(session, minutes);
      return;
    }
    if (command === "clear") {
      await clearMaintenance(session);
      return;
    }
    console.error("usage: node dist/maintenance.js start <minutes> | clear");
    process.exitCode = 2;
  } finally {
    session.socket.close();
  }
}

main().catch((error: unknown) => {
  console.error("[maintenance]", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
