import { dispatchBeacon } from "../server/lib/dispatch-beacon";

const INTERVAL_MS = 30 * 60 * 1000;

async function tick() {
  try {
    const result = await dispatchBeacon();
    console.log(
      `[beacon] dispatched to ${result.dispatched} subscription(s) at ${new Date().toISOString()}`
    );
  } catch (error) {
    console.error("[beacon] dispatch failed", error);
  }
}

tick();
setInterval(tick, INTERVAL_MS);
