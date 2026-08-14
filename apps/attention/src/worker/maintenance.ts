import { purgeExpiredMessages } from "../server/lib/purge-expired-messages";

const INTERVAL_MS = 60 * 60 * 1000;

async function tick() {
  try {
    const result = await purgeExpiredMessages();
    console.log(`[maintenance] purged ${result.purged} message body(ies) at ${new Date().toISOString()}`);
  } catch (error) {
    console.error("[maintenance] purge failed", error);
  }
}

tick();
setInterval(tick, INTERVAL_MS);
