import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PushPayload, PushSubscriptionTarget } from "@capital/server/lib/web-push";

const push = vi.hoisted(() => ({
  configured: true,
  sent: [] as { subs: PushSubscriptionTarget[]; payload: PushPayload }[],
  failFor: null as null | ((payload: PushPayload) => unknown),
}));
vi.mock("@capital/server/lib/web-push", () => ({
  isPushConfigured: () => push.configured,
  sendToSubscriptions: vi.fn(async (subs: PushSubscriptionTarget[], payload: PushPayload) => {
    if (push.failFor) {
      const problem = push.failFor(payload);
      if (problem) throw problem;
    }
    push.sent.push({ subs, payload });
    return { sent: subs.length, failed: 0 };
  }),
}));

const { prisma } = await import("@capital/server/lib/prisma");
const { createLedgerFixture, deleteLedgerFixture } = await import("@/test/ledger-fixtures");
const { createEntry } = await import("@capital/server/modules/ledger/services/entries");
const { createHolding } = await import("@capital/server/modules/investments/services/portfolio");
const { runNotifications } = await import("../services/notify");
const { getNotificationSettings, notificationSettingsFor, updateNotificationSettings } = await import("../services/settings");
const { isoWeekKey } = await import("../lib/schedule");

const USER = "test-user-notify-edge-001";
const OTHER = "test-user-notify-edge-002";
let f: Awaited<ReturnType<typeof createLedgerFixture>>;

// Tuesday 2026-10-06, 13:00 in São Paulo: the card (closes on the 5th) closed yesterday.
const TUESDAY_1PM = new Date("2026-10-06T16:00:00Z");
const NONE = { bill_closed: 0, budget_threshold: 0, weekly_summary: 0, asset_stale: 0 };

beforeEach(async () => {
  push.configured = true;
  push.sent.length = 0;
  push.failFor = null;
  f = await createLedgerFixture(prisma, USER);
  await createLedgerFixture(prisma, OTHER);
  await prisma.pushSubscription.create({ data: { userId: USER, endpoint: `https://push.example/${USER}`, p256dh: "k", auth: "a", deviceLabel: "Mac|Chrome" } });
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
  await deleteLedgerFixture(prisma, OTHER);
});

const run = (now = TUESDAY_1PM, userIds = [USER]) => runNotifications(prisma, now, { userIds });
const onlyBills = () => updateNotificationSettings(USER, { budgetEnabled: false, weeklyEnabled: false, assetStaleEnabled: false }, prisma);
const cardPurchase = () => createEntry(USER, { kind: "expense", accountId: f.card, amount: 300, description: "iFood", categoryId: f.categories.Software, date: "2026-10-03" }, prisma);

describe("runNotifications as a whole", () => {
  it("does nothing, and claims nothing, while push is not configured", async () => {
    push.configured = false;
    await cardPurchase();
    const result = await run();
    expect(result).toEqual({ users: 0, claimed: NONE, alreadySent: 0, sent: 0, failed: 0, errors: [], skipped: "push_not_configured" });
    expect(push.sent).toEqual([]);
    expect(await prisma.notificationDispatch.count({ where: { userId: USER } })).toBe(0);
  });

  it("skips users with no live device, and only the users it is asked for", async () => {
    await cardPurchase();
    await prisma.pushSubscription.updateMany({ where: { userId: USER }, data: { deadAt: new Date() } });
    expect(await run()).toMatchObject({ users: 0, claimed: NONE });

    await prisma.pushSubscription.updateMany({ where: { userId: USER }, data: { deadAt: null } });
    await prisma.pushSubscription.create({ data: { userId: OTHER, endpoint: `https://push.example/${OTHER}`, p256dh: "k", auth: "a" } });
    const both = await run(TUESDAY_1PM, [USER, OTHER]);
    expect(both.users).toBe(2);
    expect(both.claimed.bill_closed).toBe(1);
    const justOther = await run(TUESDAY_1PM, [OTHER]);
    expect(justOther.users).toBe(1);
    expect(justOther.claimed).toEqual(NONE);
  });

  it("sends to all of a user's live devices and reports what the push layer says", async () => {
    await prisma.pushSubscription.create({ data: { userId: USER, endpoint: `https://push.example/${USER}/phone`, p256dh: "k2", auth: "a2", deviceLabel: "iPhone|Safari" } });
    await prisma.pushSubscription.create({ data: { userId: USER, endpoint: `https://push.example/${USER}/dead`, p256dh: "k3", auth: "a3", deadAt: new Date() } });
    await cardPurchase();
    await onlyBills();

    const result = await run();

    expect(result).toMatchObject({ users: 1, sent: 2, failed: 0, errors: [], claimed: { ...NONE, bill_closed: 1 } });
    expect(push.sent).toHaveLength(1);
    expect(push.sent[0]!.subs.map((sub) => sub.endpoint).sort()).toEqual([`https://push.example/${USER}`, `https://push.example/${USER}/phone`]);
    expect(push.sent[0]!.subs.every((sub) => !("userId" in sub))).toBe(true);
    expect(await prisma.notificationDispatch.findFirstOrThrow({ where: { userId: USER } })).toMatchObject({ kind: "bill_closed", sentCount: 2, failCount: 0 });
  });

  it("reports a sender that throws and still runs the others; the claimed push is not retried", async () => {
    await cardPurchase();
    await prisma.budget.create({
      data: { userId: USER, categoryId: f.categories.Software!, amount: 100, currency: "BRL", period: "monthly", year: 2026, month: 10, effectiveFrom: new Date(Date.UTC(2026, 9, 1, 12)) },
    });
    push.failFor = (payload) => (payload.tag.startsWith("bill-") ? new Error("push service down") : null);

    const first = await run();

    expect(first.errors).toEqual([{ userId: USER, kind: "bill_closed", message: "push service down" }]);
    expect(first.claimed).toMatchObject({ bill_closed: 1, budget_threshold: 1 });
    expect(push.sent.map((p) => p.payload.tag.split("-")[0])).toEqual(["budget"]);

    push.failFor = (payload) => (payload.tag.startsWith("budget-") ? "plain string failure" : null);
    const second = await run(new Date("2026-10-06T18:00:00Z"));
    expect(second.errors).toEqual([]);
    expect(second.alreadySent).toBe(2);
    expect(push.sent).toHaveLength(1);

    await prisma.notificationDispatch.deleteMany({ where: { userId: USER, kind: "budget_threshold" } });
    const third = await run(new Date("2026-10-06T19:00:00Z"));
    expect(third.errors).toEqual([{ userId: USER, kind: "budget_threshold", message: "plain string failure" }]);
  });
});

describe("card bill pushes", () => {
  it("stays quiet for a card that is archived or has no closing day", async () => {
    await cardPurchase();
    await onlyBills();
    await prisma.account.update({ where: { id: f.card }, data: { archivedAt: new Date() } });
    expect((await run()).claimed).toEqual(NONE);
    await prisma.account.update({ where: { id: f.card }, data: { archivedAt: null, closingDay: null } });
    expect((await run()).claimed).toEqual(NONE);
    expect(push.sent).toEqual([]);
  });

  it("works out the closing and due dates itself when the statement has none stored", async () => {
    await cardPurchase();
    await onlyBills();
    await prisma.cardStatement.updateMany({ where: { accountId: f.card }, data: { closingDate: null, dueDate: null } });

    const result = await run();

    expect(result.claimed.bill_closed).toBe(1);
    expect(push.sent[0]!.payload).toMatchObject({ title: "Fatura do Nubank fechou", body: "R$ 300,00 · vence 12/10" });
  });

  it("says how many purchases the bill holds when there is no due date to give", async () => {
    await cardPurchase();
    await createEntry(USER, { kind: "expense", accountId: f.card, amount: 50, description: "Uber", categoryId: f.categories.Software, date: "2026-10-04" }, prisma);
    await onlyBills();
    await prisma.cardStatement.updateMany({ where: { accountId: f.card }, data: { dueDate: null } });
    await prisma.account.update({ where: { id: f.card }, data: { dueDay: null } });

    await run();

    expect(push.sent[0]!.payload.body).toBe("R$ 350,00 em 2 compras");
  });

  it("does not announce a bill with no live purchases or whose refunds cancel them out", async () => {
    const purchase = await cardPurchase();
    await onlyBills();
    await prisma.ledgerEntry.update({ where: { id: purchase.entryIds[0]! }, data: { deletedAt: new Date() } });
    expect((await run()).claimed).toEqual(NONE);

    await prisma.ledgerEntry.update({ where: { id: purchase.entryIds[0]! }, data: { deletedAt: null, amount: 40 } });
    expect((await run()).claimed).toEqual(NONE);
    expect(push.sent).toEqual([]);
  });
});

describe("budget pushes", () => {
  const monthly = (data: { categoryId: string; amount: number; entityId?: string | null; period?: "monthly" | "yearly"; isTombstone?: boolean }) =>
    prisma.budget.create({
      data: {
        userId: USER,
        entityId: data.entityId ?? null,
        categoryId: data.categoryId,
        amount: data.amount,
        currency: "BRL",
        period: data.period ?? "monthly",
        year: 2026,
        month: data.period === "yearly" ? null : 10,
        effectiveFrom: new Date(Date.UTC(2026, 9, 1, 12)),
        isTombstone: data.isTombstone ?? false,
      },
    });
  const onlyBudgets = () => updateNotificationSettings(USER, { billClosedEnabled: false, weeklyEnabled: false, assetStaleEnabled: false }, prisma);

  it("has nothing to say without a monthly budget of a positive amount", async () => {
    await onlyBudgets();
    await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 900, description: "Mercado", categoryId: f.categories.Groceries, date: "2026-10-02" }, prisma);
    expect((await run()).claimed).toEqual(NONE);

    await monthly({ categoryId: f.categories.Groceries!, amount: 0 });
    await monthly({ categoryId: f.categories.Software!, amount: 100, period: "yearly" });
    await monthly({ categoryId: f.categories.Salary!, amount: 100, isTombstone: true });
    expect((await run()).claimed).toEqual(NONE);
    expect(push.sent).toEqual([]);
  });

  it("counts only the budget's own entity when the budget has one, and every entity when it has none", async () => {
    await onlyBudgets();
    const pjEntry = { kind: "expense" as const, accountId: f.pjChecking, amount: 600, description: "Mercado PJ", categoryId: f.categories.Groceries, date: "2026-10-02" };
    await createEntry(USER, { ...pjEntry, accountId: f.pfChecking, amount: 460, description: "Mercado PF" }, prisma);
    await createEntry(USER, pjEntry, prisma);
    const scoped = await monthly({ categoryId: f.categories.Groceries!, amount: 1000, entityId: f.pfId });

    // Personal spending is R$ 460 of R$ 1.000: the company's R$ 600 is not part of it.
    expect((await run()).claimed.budget_threshold).toBe(0);

    await prisma.budget.delete({ where: { id: scoped.id } });
    await monthly({ categoryId: f.categories.Groceries!, amount: 1000, entityId: null });
    const everyone = await run();
    expect(everyone.claimed.budget_threshold).toBe(1);
    expect(push.sent[0]!.payload.body).toBe("R$ 1.060,00 de R$ 1.000,00 em out/2026");
    const dispatch = await prisma.notificationDispatch.findFirstOrThrow({ where: { userId: USER, kind: "budget_threshold" } });
    expect(dispatch.dedupeKey).toBe(`*:${f.categories.Groceries}:2026-10`);
  });

  it("keys the push by entity, so a company budget and a personal one on the same category are separate", async () => {
    await onlyBudgets();
    await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 95, description: "PF", categoryId: f.categories.Groceries, date: "2026-10-02" }, prisma);
    await createEntry(USER, { kind: "expense", accountId: f.pjChecking, amount: 95, description: "PJ", categoryId: f.categories.Groceries, date: "2026-10-02" }, prisma);
    await monthly({ categoryId: f.categories.Groceries!, amount: 100, entityId: f.pfId });
    await monthly({ categoryId: f.categories.Groceries!, amount: 100, entityId: f.pjId });

    const result = await run();

    expect(result.claimed.budget_threshold).toBe(2);
    const keys = (await prisma.notificationDispatch.findMany({ where: { userId: USER, kind: "budget_threshold" } })).map((row) => row.dedupeKey).sort();
    expect(keys).toEqual([`${f.pfId}:${f.categories.Groceries}:2026-10`, `${f.pjId}:${f.categories.Groceries}:2026-10`].sort());
  });
});

describe("weekly summary", () => {
  it("sends nothing for a week without income or expenses", async () => {
    await updateNotificationSettings(USER, { weeklyEnabled: true, weeklyDow: 2, weeklyHour: 8, billClosedEnabled: false, budgetEnabled: false, assetStaleEnabled: false }, prisma);
    expect((await run()).claimed).toEqual(NONE);
    // A transfer is not income or expense, so it does not make a week worth reporting.
    const savings = await prisma.account.create({ data: { userId: USER, entityId: f.pfId, type: "cash", name: "Reserva", currency: "BRL" } });
    await createEntry(USER, { kind: "transfer", fromAccountId: f.pfChecking, toAccountId: savings.id, amount: 80, date: "2026-10-02", description: "Reserva" }, prisma);
    expect((await run()).claimed).toEqual(NONE);
    expect(push.sent).toEqual([]);

    await createEntry(USER, { kind: "income", accountId: f.pfChecking, amount: 10, description: "Cashback", categoryId: f.categories.Salary, date: "2026-10-02" }, prisma);
    expect((await run()).claimed.weekly_summary).toBe(1);
  });
});

describe("stale price pushes", () => {
  afterAll(async () => {
    await prisma.asset.deleteMany({ where: { symbol: { startsWith: "ZZNOTIFYEDGE" } } });
  });

  it("never pushes for a linked holding that has no ticker: the coverage panel reports it as 'no ticker', not as stale", async () => {
    await updateNotificationSettings(USER, { billClosedEnabled: false, budgetEnabled: false }, prisma);
    const holding = await createHolding(USER, { accountId: f.broker, assetClass: "stocks", name: "Ação sem ticker", currency: "BRL" }, prisma);
    const asset = await prisma.asset.create({ data: { symbol: "ZZNOTIFYEDGE1", assetClass: "stocks", market: "B3", currency: "BRL" } });
    await prisma.investmentHolding.update({ where: { id: holding.id }, data: { assetId: asset.id, priceSource: "auto", currentPrice: 10, lastPriceUpdate: new Date("2026-10-01T20:10:00Z") } });

    const result = await run();

    expect(result.claimed.asset_stale).toBe(0);
    expect(push.sent).toEqual([]);
  });
});

describe("settings", () => {
  it("returns defaults for users without a row and an empty map for nobody", async () => {
    expect(await notificationSettingsFor([], prisma)).toEqual(new Map());
    await updateNotificationSettings(OTHER, { weeklyEnabled: true, budgetThreshold: 0.5 }, prisma);
    const map = await notificationSettingsFor([USER, OTHER], prisma);
    expect(map.get(USER)).toMatchObject({ weeklyEnabled: false, budgetThreshold: 0.9, dueHour: 9 });
    expect(map.get(OTHER)).toMatchObject({ weeklyEnabled: true, budgetThreshold: 0.5, dueHour: 9 });
    expect(await getNotificationSettings(USER, prisma)).toMatchObject({ weeklyEnabled: false });
  });
});

describe("ISO weeks", () => {
  it("puts a Sunday in the week that started on the Monday before it", () => {
    expect(isoWeekKey("2026-10-04")).toBe("2026-W40");
    expect(isoWeekKey("2026-10-05")).toBe("2026-W41");
    expect(isoWeekKey("2026-03-01")).toBe("2026-W09");
  });
});
