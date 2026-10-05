/**
 * Seconds between expected runs for the cron dialects used in
 * infrastructure/cronjobs/schedules. Throws on anything else so a new
 * schedule fails the unit test instead of getting a silent wrong interval.
 */
export function cronPeriodSeconds(expr: string): number {
  const parts = expr.trim().split(/\s+/);
  if (parts.length < 5) throw new Error(`unsupported cron: ${expr}`);
  const [min, hour, dom, month, dow] = parts;
  if (min === undefined || hour === undefined || dom === undefined || month !== "*" || dow !== "*") {
    throw new Error(`unsupported cron: ${expr}`);
  }
  if (dom !== "*") return 32 * 24 * 3600;

  const minuteEvery = /^\*\/(\d+)$/.exec(min);
  if (minuteEvery?.[1]) return Number(minuteEvery[1]) * 60;

  if (min.includes(",")) {
    const nums = min.split(",").map((part) => Number(part));
    if (nums.some((n) => !Number.isInteger(n))) throw new Error(`unsupported cron: ${expr}`);
    const sorted = [...nums].sort((a, b) => a - b);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    if (first === undefined || last === undefined) throw new Error(`unsupported cron: ${expr}`);
    let gap = 60 - last + first;
    for (let i = 1; i < sorted.length; i++) {
      const current = sorted[i];
      const previous = sorted[i - 1];
      if (current === undefined || previous === undefined) continue;
      gap = Math.min(gap, current - previous);
    }
    return gap * 60;
  }

  const hourEvery = /^\*\/(\d+)$/.exec(hour);
  if (hourEvery?.[1]) return Number(hourEvery[1]) * 3600;
  if (hour === "*") return 3600;
  if (/^\d+$/.test(hour) && /^\d+$/.test(min)) return 26 * 3600;
  throw new Error(`unsupported cron: ${expr}`);
}

/** Added on top of the job period so a slightly late success still counts. */
export const PUSH_GRACE_SECONDS = 60;
