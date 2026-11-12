import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PushPayload, PushSubscriptionTarget } from "@capital/server/lib/web-push";

// The push service is never called: sendToSubscriptions is the seam, and the test decides what it answers.
const push = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@capital/server/lib/web-push", () => ({
  isPushConfigured: () => true,
  sendToSubscriptions: push.send,
}));

import { prisma } from "@capital/server/lib/prisma";
import { createFormatter } from "@/lib/format";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { updateNotificationSettings } from "@capital/server/modules/notifications/services/settings";
import { allowedInstances, buildPayload, DEFAULT_OVERDUE_MAX_DAYS, defaultRemindersConfig, sendDueReminders } from "../send-due-reminders";
import type { ReminderInstance } from "../reminder-schedule";

const USER = "test-user-recurring-reminders-001";
const OTHER = "test-user-recurring-reminders-002";
let f: LedgerFixture;
let o: LedgerFixture;

// Tuesday 2026-10-06, 09:05 in São Paulo.
const NINE_AM = new Date("2026-10-06T12:05:00Z");

beforeEach(async () => {
  push.send.mockReset();
  push.send.mockImplementation(async (subs: PushSubscriptionTarget[]) => ({ sent: subs.length, failed: 0 }));
  f = await createLedgerFixture(prisma, USER, { categories: [{ name: "Moradia", type: "expense" }] });
  o = await createLedgerFixture(prisma, OTHER);
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
  await deleteLedgerFixture(prisma, OTHER);
});

const subscribe = (userId: string, n = 1) =>
  Promise.all(Array.from({ length: n }, (_, i) => prisma.pushSubscription.create({ data: { userId, endpoint: `https://push.example/${userId}/${i}`, p256dh: `k${i}`, auth: `a${i}` } })));

const rule = (overrides: Record<string, unknown> = {}, owner: { userId: string; entityId: string; accountId: string } = { userId: USER, entityId: f.pfId, accountId: f.pfChecking }) =>
  prisma.recurringRule.create({
    data: {
      ...owner,
      kind: "expense",
      amount: 2500,
      currency: "BRL",
      description: "Aluguel",
      frequency: "monthly",
      startDate: new Date("2026-01-07T12:00:00Z"),
      nextDueDate: new Date("2026-10-07T12:00:00Z"),
      autoGenerate: false,
      ...overrides,
    },
  });
const run = (opts: { userIds?: string[] } = { userIds: [USER, OTHER] }, now = NINE_AM) => sendDueReminders(prisma, now, opts);

const inst = (kind: ReminderInstance["kind"], daysBefore: number): ReminderInstance => ({ kind, daysBefore, scheduledAt: NINE_AM });

describe("defaultRemindersConfig", () => {
  it("follows the user's settings: days before at the hour, the overdue nag at the same hour", () => {
    expect(defaultRemindersConfig({ dueDaysBefore: 3, dueHour: 7, overdueEnabled: true })).toEqual({ entries: [{ daysBefore: 3, time: "07:00" }], overdue: { enabled: true, time: "07:00" } });
    expect(defaultRemindersConfig({ dueDaysBefore: 0, dueHour: 18, overdueEnabled: false })).toEqual({ entries: [{ daysBefore: 0, time: "18:00" }], overdue: { enabled: false, time: "18:00" } });
  });
});

describe("allowedInstances", () => {
  const all = [inst("pre-due", 1), inst("due-today", 0), inst("overdue", -2), inst("overdue", -(DEFAULT_OVERDUE_MAX_DAYS + 1))];

  it("drops due reminders when the due toggle is off, and overdue ones when the overdue toggle is off", () => {
    expect(allowedInstances(all, { dueEnabled: false, overdueEnabled: true }, false).map((i) => i.daysBefore)).toEqual([-2, -8]);
    expect(allowedInstances(all, { dueEnabled: true, overdueEnabled: false }, false).map((i) => i.daysBefore)).toEqual([1, 0]);
    expect(allowedInstances(all, { dueEnabled: false, overdueEnabled: false }, false)).toEqual([]);
  });

  it("stops the default overdue nag after a week, but not a rule's own", () => {
    const prefs = { dueEnabled: true, overdueEnabled: true };
    expect(allowedInstances(all, prefs, true).map((i) => i.daysBefore)).toEqual([1, 0, -2]);
    expect(allowedInstances(all, prefs, false).map((i) => i.daysBefore)).toEqual([1, 0, -2, -8]);
    expect(allowedInstances([inst("overdue", -DEFAULT_OVERDUE_MAX_DAYS)], prefs, true)).toHaveLength(1);
  });
});

describe("buildPayload", () => {
  const row = { id: "r1", description: "Aluguel", category: "Moradia", amount: 2500, currency: "BRL", nextDueDate: new Date("2026-10-10T12:00:00Z") };

  it("says a bill is due today, tomorrow or in N days, in the user's language", () => {
    expect(buildPayload(row, inst("due-today", 0))).toEqual({ title: "Lembrete: Aluguel", body: "Vence hoje — ~R$ 2.500,00 (Moradia)", tag: "reminder-r1-2026-10-10", url: "/transactions/budgets" });
    expect(buildPayload(row, inst("pre-due", 1)).body).toBe("Vence amanhã — ~R$ 2.500,00 (Moradia)");
    expect(buildPayload(row, inst("pre-due", 3)).body).toBe("Vence em 3 dias — ~R$ 2.500,00 (Moradia)");
    const en = buildPayload(row, inst("pre-due", 3), { locale: "en", fmt: createFormatter({ locale: "en", baseCurrency: "BRL" }) });
    expect(en.title).toBe("Reminder: Aluguel");
    expect(en.body).toContain("3 days");
  });

  it("counts the days overdue, singular for one", () => {
    expect(buildPayload(row, inst("overdue", -1))).toMatchObject({ title: "Atrasado: Aluguel", body: "Venceu há 1 dia — ~R$ 2.500,00 (Moradia). Marque como pago ou concluído." });
    expect(buildPayload(row, inst("overdue", -4)).body).toBe("Venceu há 4 dias — ~R$ 2.500,00 (Moradia). Marque como pago ou concluído.");
    const en = { locale: "en" as const, fmt: createFormatter({ locale: "en", baseCurrency: "BRL" }) };
    expect(buildPayload(row, inst("overdue", -1), en).body).toMatch(/^Due 1 day ago — ~R\$.*2.*500.*\(Moradia\)\. Mark it as paid or done\.$/);
    expect(buildPayload(row, inst("overdue", -4), en).body).toContain("Due 4 days ago");
  });

  it("names a bill with no category in the language of the user, and formats other currencies", () => {
    const pt = buildPayload({ ...row, category: null, currency: "USD", amount: 19.9 }, inst("pre-due", 1));
    expect(pt.body).toBe("Vence amanhã — ~US$ 19,90 (Sem categoria)");
    const en = buildPayload({ ...row, category: null }, inst("pre-due", 1), { locale: "en" });
    expect(en.body).toContain("(Uncategorized)");
  });
});

describe("sendDueReminders", () => {
  it("counts the rules it looked at and does nothing when there is none", async () => {
    expect(await run()).toEqual({ rowsScanned: 0, rowsWithoutSubscription: 0, instancesClaimed: 0, instancesAlreadySent: 0, instancesMuted: 0, notificationsSent: 0, notificationsFailed: 0 });
    expect(push.send).not.toHaveBeenCalled();
  });

  it("only looks at active reminder rules of the users asked for", async () => {
    await subscribe(USER);
    await rule({ description: "Auto", autoGenerate: true });
    await rule({ description: "Pausada", isActive: false });
    await rule({ description: "Lembrete" });
    await subscribe(OTHER);
    await rule({ description: "Dela" }, { userId: OTHER, entityId: o.pfId, accountId: o.pfChecking });
    expect((await run({ userIds: [USER] })).rowsScanned).toBe(1);
    expect((await run({ userIds: [OTHER] })).rowsScanned).toBe(1);
    expect((await run({ userIds: [] })).rowsScanned).toBe(0);
  });

  it("pushes a due reminder to every live device of the owner, and records what was sent", async () => {
    await subscribe(USER, 2);
    await prisma.pushSubscription.create({ data: { userId: USER, endpoint: "https://push.example/dead", p256dh: "k", auth: "a", deadAt: new Date() } });
    await subscribe(OTHER);
    const r = await rule({ categoryId: f.categories.Moradia });
    const result = await run();
    expect(result).toMatchObject({ rowsScanned: 1, instancesClaimed: 1, notificationsSent: 2, notificationsFailed: 0, instancesAlreadySent: 0, instancesMuted: 0 });
    expect(push.send).toHaveBeenCalledTimes(1);
    const [targets, payload] = push.send.mock.calls[0] as [PushSubscriptionTarget[], PushPayload];
    expect(targets.map((t) => t.endpoint).sort()).toEqual([`https://push.example/${USER}/0`, `https://push.example/${USER}/1`]);
    expect(targets[0]).toEqual({ id: expect.any(String), endpoint: expect.any(String), p256dh: expect.any(String), auth: expect.any(String) });
    expect(payload).toEqual({ title: "Lembrete: Aluguel", body: "Vence amanhã — ~R$ 2.500,00 (Moradia)", tag: "reminder-" + r.id + "-2026-10-07", url: "/transactions/budgets" });
    const dispatch = await prisma.reminderDispatch.findFirstOrThrow({ where: { recurringRuleId: r.id } });
    expect(dispatch).toMatchObject({ daysBefore: 1, sentCount: 2, failCount: 0 });
    expect(dispatch.occurrenceDate.toISOString()).toBe("2026-10-07T12:00:00.000Z");
  });

  it("sends each instance only once, however often the cron ticks", async () => {
    await subscribe(USER);
    await rule();
    expect((await run({ userIds: [USER] })).instancesClaimed).toBe(1);
    const again = await run({ userIds: [USER] });
    expect(again).toMatchObject({ instancesClaimed: 0, instancesAlreadySent: 1, notificationsSent: 0 });
    expect(push.send).toHaveBeenCalledTimes(1);
  });

  it("reports failures and keeps them in the ledger", async () => {
    await subscribe(USER, 3);
    push.send.mockResolvedValueOnce({ sent: 1, failed: 2 });
    const r = await rule();
    const result = await run({ userIds: [USER] });
    expect(result).toMatchObject({ instancesClaimed: 1, notificationsSent: 1, notificationsFailed: 2 });
    expect(await prisma.reminderDispatch.findFirstOrThrow({ where: { recurringRuleId: r.id } })).toMatchObject({ sentCount: 1, failCount: 2 });
  });

  it("counts a rule whose owner has no live device and sends nothing", async () => {
    await rule();
    await prisma.pushSubscription.create({ data: { userId: USER, endpoint: "https://push.example/dead", p256dh: "k", auth: "a", deadAt: new Date() } });
    const result = await run({ userIds: [USER] });
    expect(result).toMatchObject({ rowsScanned: 1, rowsWithoutSubscription: 1, instancesClaimed: 0 });
    expect(push.send).not.toHaveBeenCalled();
    expect(await prisma.reminderDispatch.count({ where: { recurringRule: { userId: USER } } })).toBe(0);
  });

  it("skips an owner who turned both reminder toggles off, but counts a half-muted rule's muted instances", async () => {
    await subscribe(USER);
    await rule();
    await updateNotificationSettings(USER, { dueEnabled: false, overdueEnabled: false }, prisma);
    const off = await run({ userIds: [USER] });
    expect(off).toMatchObject({ rowsScanned: 1, instancesClaimed: 0, instancesMuted: 0 });

    await updateNotificationSettings(USER, { dueEnabled: false, overdueEnabled: true }, prisma);
    const muted = await run({ userIds: [USER] });
    expect(muted).toMatchObject({ instancesClaimed: 0, instancesMuted: 1 });
    expect(push.send).not.toHaveBeenCalled();
  });

  it("uses a rule's own reminders over the defaults, and skips a rule whose config is unreadable", async () => {
    await subscribe(USER);
    await rule({ description: "Ruim", reminders: { entries: "nope" } });
    const own = await rule({ description: "Propria", reminders: { entries: [{ daysBefore: 1, time: "09:00" }, { daysBefore: 0, time: "08:00" }], overdue: { enabled: false, time: "09:00" } } });
    const result = await run({ userIds: [USER] });
    expect(result).toMatchObject({ rowsScanned: 2, instancesClaimed: 1 });
    expect((await prisma.reminderDispatch.findMany({ where: { recurringRuleId: own.id } })).map((d) => d.daysBefore)).toEqual([1]);
    expect(push.send).toHaveBeenCalledTimes(1);
  });

  it("sends the overdue nag in the owner's language and number format", async () => {
    await prisma.user.update({ where: { id: USER }, data: { locale: "en" } });
    await subscribe(USER);
    await rule({ nextDueDate: new Date("2026-10-04T12:00:00Z"), description: "Rent" });
    const result = await run({ userIds: [USER] });
    expect(result.instancesClaimed).toBe(1);
    const payload = push.send.mock.calls[0][1] as PushPayload;
    expect(payload.title).toBe("Overdue: Rent");
    expect(payload.body).toContain("2 days");
    // Two rules of the same owner reuse one formatter and each still gets its push.
    await rule({ nextDueDate: new Date("2026-10-05T12:00:00Z"), description: "Water" });
    push.send.mockClear();
    await run({ userIds: [USER] });
    expect(push.send).toHaveBeenCalledTimes(1);
    expect((push.send.mock.calls[0][1] as PushPayload).title).toBe("Overdue: Water");
  });

  it("lets an unexpected database error through, instead of swallowing it", async () => {
    await subscribe(USER);
    const r = await rule();
    const create = vi.spyOn(prisma.reminderDispatch, "create").mockRejectedValueOnce(new Error("connection lost"));
    await expect(run({ userIds: [USER] })).rejects.toThrow("connection lost");
    create.mockRestore();
    expect(await prisma.reminderDispatch.count({ where: { recurringRuleId: r.id } })).toBe(0);
  });
});
