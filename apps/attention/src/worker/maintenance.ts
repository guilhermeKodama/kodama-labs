import { purgeExpiredMessages } from "../server/lib/purge-expired-messages";
import { requeueZombies } from "../server/jobs/queue";

const INTERVAL_MS = 60 * 60 * 1000;

async function tick() {
  try {
    const result = await purgeExpiredMessages();
    console.log(`[maintenance] purged ${result.purged} message body(ies) at ${new Date().toISOString()}`);
  } catch (error) {
    console.error("[maintenance] purge failed", error);
  }

  try {
    const requeued = await requeueZombies();
    if (requeued > 0) console.log(`[maintenance] requeued ${requeued} zombie job(s)`);
  } catch (error) {
    console.error("[maintenance] zombie requeue failed", error);
  }
}

tick();
setInterval(tick, INTERVAL_MS);
