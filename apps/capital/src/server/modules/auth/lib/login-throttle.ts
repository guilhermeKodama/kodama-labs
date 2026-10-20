/**
 * Failed sign-in attempts, counted in memory: the app runs as one web
 * container, so a map is enough, and a deploy starts it empty. Without
 * Cloudflare Access in front, this is what stops someone from trying
 * passwords one after another.
 *
 * Two budgets over a sliding window: one per account from one address, so
 * a single person mistyping is not punished for someone else's attempts,
 * and one per address across accounts, so trying many emails is limited
 * too. A successful sign-in clears that account's count.
 */
export const LOGIN_WINDOW_MS = 15 * 60_000;
export const MAX_FAILURES_PER_ACCOUNT = 5;
export const MAX_FAILURES_PER_ADDRESS = 20;

export class LoginThrottle {
  private readonly failures = new Map<string, number[]>();

  /** Milliseconds until `ip` may try `email` again; 0 when it may try now. */
  retryAfterMs(ip: string, email: string, now: number): number {
    return Math.max(this.wait(accountKey(ip, email), MAX_FAILURES_PER_ACCOUNT, now), this.wait(addressKey(ip), MAX_FAILURES_PER_ADDRESS, now));
  }

  recordFailure(ip: string, email: string, now: number): void {
    for (const key of [accountKey(ip, email), addressKey(ip)]) this.failures.set(key, [...this.recent(key, now), now]);
    this.prune(now);
  }

  recordSuccess(ip: string, email: string): void {
    this.failures.delete(accountKey(ip, email));
  }

  private wait(key: string, max: number, now: number): number {
    const recent = this.recent(key, now);
    if (recent.length < max) return 0;
    // The oldest failure that still counts leaves the window first.
    return recent[recent.length - max] + LOGIN_WINDOW_MS - now;
  }

  private recent(key: string, now: number): number[] {
    return (this.failures.get(key) ?? []).filter((at) => now - at < LOGIN_WINDOW_MS);
  }

  /** Drops keys whose failures all left the window, so the map stays small. */
  private prune(now: number): void {
    if (this.failures.size < 1000) return;
    for (const [key, times] of this.failures) if (times.every((at) => now - at >= LOGIN_WINDOW_MS)) this.failures.delete(key);
  }
}

const accountKey = (ip: string, email: string) => `account:${ip}:${email.trim().toLowerCase()}`;
const addressKey = (ip: string) => `address:${ip}`;

/** The visitor's address: Cloudflare's header (the app sits behind cloudflared), else the first forwarded hop. */
export function clientAddress(header: (name: string) => string | undefined): string {
  return header("cf-connecting-ip")?.trim() || header("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export const loginThrottle = new LoginThrottle();
