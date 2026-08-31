import { describe, it, expect } from "vitest";
import { fromZonedTime } from "date-fns-tz";
import {
  computePreDueInstances,
  computeOverdueInstance,
  computeDueReminderInstances,
  getDueYmd,
  REMINDER_STALENESS_MS,
} from "../reminder-schedule";
import type { RemindersConfig } from "@/lib/validations/reminders";

// America/Sao_Paulo has been a fixed UTC-3 offset with no DST since Brazil
// abolished it in 2019 — used as the "simple" timezone throughout so exact
// UTC instants are easy to hand-verify (09:00 BRT == 12:00 UTC).
const SAO_PAULO = "America/Sao_Paulo";

describe("computePreDueInstances", () => {
  const nextDueDate = new Date("2026-09-15T12:00:00.000Z"); // due Sep 15

  it("computes the exact UTC instant for a daysBefore:0 (due today) entry", () => {
    const config: RemindersConfig = {
      entries: [{ daysBefore: 0, time: "09:00" }],
      overdue: { enabled: false, time: "09:00" },
    };
    const now = new Date("2026-09-15T12:00:00.000Z"); // 09:00 BRT == 12:00 UTC
    const instances = computePreDueInstances(config, nextDueDate, SAO_PAULO, now);
    expect(instances).toHaveLength(1);
    expect(instances[0].daysBefore).toBe(0);
    expect(instances[0].kind).toBe("due-today");
    expect(instances[0].scheduledAt.toISOString()).toBe("2026-09-15T12:00:00.000Z");
  });

  it("computes the exact UTC instant for a daysBefore:1 entry", () => {
    const config: RemindersConfig = {
      entries: [{ daysBefore: 1, time: "09:00" }],
      overdue: { enabled: false, time: "09:00" },
    };
    const now = new Date("2026-09-14T12:00:00.000Z");
    const instances = computePreDueInstances(config, nextDueDate, SAO_PAULO, now);
    expect(instances).toHaveLength(1);
    expect(instances[0].kind).toBe("pre-due");
    expect(instances[0].scheduledAt.toISOString()).toBe("2026-09-14T12:00:00.000Z");
  });

  it("computes the exact UTC instant for a daysBefore:7 entry", () => {
    const config: RemindersConfig = {
      entries: [{ daysBefore: 7, time: "09:00" }],
      overdue: { enabled: false, time: "09:00" },
    };
    const now = new Date("2026-09-08T12:00:00.000Z");
    const instances = computePreDueInstances(config, nextDueDate, SAO_PAULO, now);
    expect(instances).toHaveLength(1);
    expect(instances[0].scheduledAt.toISOString()).toBe("2026-09-08T12:00:00.000Z");
  });

  it("does not fire before the scheduled instant", () => {
    const config: RemindersConfig = {
      entries: [{ daysBefore: 0, time: "09:00" }],
      overdue: { enabled: false, time: "09:00" },
    };
    const now = new Date("2026-09-15T11:59:00.000Z");
    expect(computePreDueInstances(config, nextDueDate, SAO_PAULO, now)).toHaveLength(0);
  });

  it("staleness window: still fires just under 24h after scheduledAt", () => {
    const config: RemindersConfig = {
      entries: [{ daysBefore: 0, time: "09:00" }],
      overdue: { enabled: false, time: "09:00" },
    };
    const now = new Date(new Date("2026-09-15T12:00:00.000Z").getTime() + REMINDER_STALENESS_MS - 1000);
    expect(computePreDueInstances(config, nextDueDate, SAO_PAULO, now)).toHaveLength(1);
  });

  it("staleness window: suppressed just over 24h after scheduledAt", () => {
    const config: RemindersConfig = {
      entries: [{ daysBefore: 0, time: "09:00" }],
      overdue: { enabled: false, time: "09:00" },
    };
    const now = new Date(new Date("2026-09-15T12:00:00.000Z").getTime() + REMINDER_STALENESS_MS + 1000);
    expect(computePreDueInstances(config, nextDueDate, SAO_PAULO, now)).toHaveLength(0);
  });

  it("returns nothing for an empty entries list", () => {
    const config: RemindersConfig = { entries: [], overdue: { enabled: false, time: "09:00" } };
    const now = new Date("2026-09-15T12:00:00.000Z");
    expect(computePreDueInstances(config, nextDueDate, SAO_PAULO, now)).toHaveLength(0);
  });
});

describe("computeOverdueInstance", () => {
  const nextDueDate = new Date("2026-09-15T12:00:00.000Z");

  it("does not fire on the due date itself — daysOverdue must be >= 1", () => {
    const config: RemindersConfig = { entries: [], overdue: { enabled: true, time: "09:00" } };
    const now = new Date("2026-09-15T12:00:00.000Z"); // same calendar day as due date
    expect(computeOverdueInstance(config, nextDueDate, SAO_PAULO, now)).toBeNull();
  });

  it("fires with daysBefore:-1 the day after the due date", () => {
    const config: RemindersConfig = { entries: [], overdue: { enabled: true, time: "09:00" } };
    const now = new Date("2026-09-16T12:00:00.000Z"); // Sep 16, 09:00 BRT
    const instance = computeOverdueInstance(config, nextDueDate, SAO_PAULO, now);
    expect(instance).not.toBeNull();
    expect(instance?.daysBefore).toBe(-1);
    expect(instance?.kind).toBe("overdue");
  });

  it("fires with daysBefore:-3 three days after the due date", () => {
    const config: RemindersConfig = { entries: [], overdue: { enabled: true, time: "09:00" } };
    const now = new Date("2026-09-18T12:00:00.000Z");
    const instance = computeOverdueInstance(config, nextDueDate, SAO_PAULO, now);
    expect(instance?.daysBefore).toBe(-3);
  });

  it("returns null when overdue nagging is disabled", () => {
    const config: RemindersConfig = { entries: [], overdue: { enabled: false, time: "09:00" } };
    const now = new Date("2026-09-20T12:00:00.000Z");
    expect(computeOverdueInstance(config, nextDueDate, SAO_PAULO, now)).toBeNull();
  });

  it("returns null once the occurrence has moved to the future (post mark-paid / concluir)", () => {
    const config: RemindersConfig = { entries: [], overdue: { enabled: true, time: "09:00" } };
    const futureNextDueDate = new Date("2026-10-15T12:00:00.000Z");
    const now = new Date("2026-09-20T12:00:00.000Z");
    expect(computeOverdueInstance(config, futureNextDueDate, SAO_PAULO, now)).toBeNull();
  });

  it("resolves the overdue day boundary using the user's timezone, not the server's UTC calendar date", () => {
    // At this instant it's already 09:00 on Jan 21 in Auckland (UTC+13,
    // NZDT in January) even though the UTC calendar date is still Jan 20 —
    // a naive UTC-based day-diff would wrongly say "not overdue yet".
    const dueDate = new Date("2026-01-20T12:00:00.000Z");
    const now = new Date("2026-01-20T20:00:00.000Z");
    const config: RemindersConfig = { entries: [], overdue: { enabled: true, time: "09:00" } };
    const instance = computeOverdueInstance(config, dueDate, "Pacific/Auckland", now);
    expect(instance).not.toBeNull();
    expect(instance?.daysBefore).toBe(-1);
    expect(instance?.scheduledAt.toISOString()).toBe("2026-01-20T20:00:00.000Z");
  });
});

describe("computeDueReminderInstances", () => {
  it("never double-fires the due-today entry and the overdue nag on the due date itself", () => {
    const nextDueDate = new Date("2026-09-15T12:00:00.000Z");
    const config: RemindersConfig = {
      entries: [{ daysBefore: 0, time: "09:00" }],
      overdue: { enabled: true, time: "09:00" },
    };
    const now = new Date("2026-09-15T12:00:00.000Z"); // due date, 09:00 BRT
    const instances = computeDueReminderInstances(config, nextDueDate, SAO_PAULO, now);
    expect(instances).toHaveLength(1);
    expect(instances[0].daysBefore).toBe(0);
  });

  it("can return both a still-live day-of entry and the overdue nag together", () => {
    // A due-today entry scheduled late (23:00) stays within its 24h
    // staleness window into the next calendar day, overlapping with that
    // day's overdue nag (09:00) — the function must return both instances,
    // not clobber one in favor of the other.
    const nextDueDate = new Date("2026-09-15T12:00:00.000Z");
    const config: RemindersConfig = {
      entries: [{ daysBefore: 0, time: "23:00" }],
      overdue: { enabled: true, time: "09:00" },
    };
    const now = new Date("2026-09-16T13:00:00.000Z"); // Sep 16, 10:00 BRT
    const instances = computeDueReminderInstances(config, nextDueDate, SAO_PAULO, now);
    const daysBeforeValues = instances.map((i) => i.daysBefore).sort();
    expect(daysBeforeValues).toEqual([-1, 0]);
  });
});

describe("getDueYmd", () => {
  it("reads the calendar date from UTC date parts (nextDueDate is stored at noon UTC)", () => {
    expect(getDueYmd(new Date("2026-09-15T12:00:00.000Z"))).toBe("2026-09-15");
  });

  it("changes when the occurrence advances — this is what stops overdue nagging after mark-paid/concluir", () => {
    expect(getDueYmd(new Date("2026-09-15T12:00:00.000Z"))).not.toBe(
      getDueYmd(new Date("2026-10-15T12:00:00.000Z"))
    );
  });
});

describe("DST safety", () => {
  it("fromZonedTime resolves a nonexistent local time (spring-forward gap) without throwing", () => {
    // 2026-03-08 is US DST start (clocks jump 02:00 -> 03:00 in
    // America/New_York), so 02:30 never occurs that day. The scheduling
    // math depends on fromZonedTime never throwing here, whatever instant
    // it resolves the gap to.
    expect(() => fromZonedTime("2026-03-08T02:30:00", "America/New_York")).not.toThrow();
    const result = fromZonedTime("2026-03-08T02:30:00", "America/New_York");
    expect(result instanceof Date).toBe(true);
    expect(Number.isNaN(result.getTime())).toBe(false);
  });
});
