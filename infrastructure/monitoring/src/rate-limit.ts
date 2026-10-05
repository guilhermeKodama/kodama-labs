export interface DueAlert {
  key: string;
  count: number;
  windowStart: number;
  windowEnd: number;
  excerpt: string;
}

interface Bucket {
  count: number;
  windowStart: number;
  quietUntil: number;
  /** 0 until the first emit of this bucket. */
  suppressUntil: number;
  excerpt: string;
}

/**
 * At most one alert per key per suppress window. The first burst waits
 * `quietMs` so the count is not always 1. Events during the suppress window
 * accumulate and go out once, when it ends.
 */
export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private expired: string[] = [];

  constructor(
    private readonly quietMs: number,
    private readonly suppressMs: number,
  ) {}

  /** Keys whose suppress window ended with nothing left to send. One drain per tick. */
  drainExpired(): string[] {
    const keys = this.expired;
    this.expired = [];
    return keys;
  }

  observe(key: string, now: number, excerpt: string): void {
    const existing = this.buckets.get(key);
    if (!existing) {
      this.buckets.set(key, {
        count: 1,
        windowStart: now,
        quietUntil: now + this.quietMs,
        suppressUntil: 0,
        excerpt,
      });
      return;
    }
    existing.count += 1;
    if (!existing.excerpt) existing.excerpt = excerpt;
  }

  collect(now: number): DueAlert[] {
    const due: DueAlert[] = [];
    for (const [key, bucket] of this.buckets) {
      const readyToOpen = bucket.suppressUntil === 0 && now >= bucket.quietUntil && bucket.count > 0;
      const readyToFlush = bucket.suppressUntil !== 0 && now >= bucket.suppressUntil && bucket.count > 0;
      if (!readyToOpen && !readyToFlush) {
        if (bucket.suppressUntil !== 0 && now >= bucket.suppressUntil && bucket.count === 0) {
          this.buckets.delete(key);
          this.expired.push(key);
        }
        continue;
      }
      due.push({
        key,
        count: bucket.count,
        windowStart: bucket.windowStart,
        windowEnd: now,
        excerpt: bucket.excerpt,
      });
      bucket.count = 0;
      bucket.excerpt = "";
      bucket.windowStart = now;
      bucket.suppressUntil = now + this.suppressMs;
    }
    return due;
  }
}
