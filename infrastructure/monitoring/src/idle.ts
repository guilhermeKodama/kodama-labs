/** Long enough to stay under Node's 2^31-1ms timer cap, short enough to stay positive. */
const KEEPALIVE_MS = 1 << 30;

/**
 * Hold the process open when there is no webhook to deliver to.
 *
 * A pending promise does not keep the event loop alive, so the watcher
 * would exit 0 and `restart: always` would loop it. The interval is the
 * active handle. SIGTERM/SIGINT drop that handle and exit 0 so `docker
 * stop` is not a kill.
 */
export function idleForever(): Promise<never> {
  const timer = setInterval(() => {}, KEEPALIVE_MS);
  const shutdown = (): void => {
    clearInterval(timer);
    process.exit(0);
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  return new Promise(() => {});
}
