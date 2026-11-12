import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PushPayload, PushSubscriptionTarget } from "@capital/server/lib/web-push";

const pushes: { subs: PushSubscriptionTarget[]; payload: PushPayload }[] = [];
vi.mock("@capital/server/lib/web-push", () => ({
  isPushConfigured: () => true,
  sendToSubscriptions: vi.fn(async (subs: PushSubscriptionTarget[], payload: PushPayload) => {
    pushes.push({ subs, payload });
    return { sent: subs.length, failed: 0 };
  }),
}));

const { prisma } = await import("@capital/server/lib/prisma");
const { createLedgerFixture, deleteLedgerFixture } = await import("@/test/ledger-fixtures");
const { createEntry } = await import("@capital/server/modules/ledger/services/entries");
const { createHolding } = await import("@capital/server/modules/investments/services/portfolio");
const { runNotifications } = await import("../services/notify");
const { updateNotificationSettings } = await import("../services/settings");
const { sendDueReminders } = await import("@capital/server/modules/recurring/services/send-due-reminders");

/** Card bill closed, budget threshold and weekly summary pushes, at frozen times, once per dispatch key; recurring reminders honour the toggles. */
const USER = "test-user-s6-notify-senders-001";
let f: Awaited<ReturnType<typeof createLedgerFixture>>;

// Tuesday 2026-10-06, 13:00 in São Paulo: the Nubank card (closes on the 5th) closed yesterday.
const TUESDAY_1PM = new Date("2026-10-06T16:00:00Z");

beforeEach(async () => {
  pushes.length = 0;
  f = await createLedgerFixture(prisma, USER);
  await prisma.pushSubscription.create({ data: { userId: USER, endpoint: `https://push.example/${USER}`, p256dh: "k", auth: "a", deviceLabel: "Mac|Chrome" } });
  await createEntry(USER, { kind: "income", accountId: f.pfChecking, amount: 1000, description: "Salário", categoryId: f.categories.Salary, date: "2026-10-01" }, prisma);
  await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 460, description: "Mercado", categoryId: f.categories.Groceries, date: "2026-10-02" }, prisma);
  await createEntry(USER, { kind: "expense", accountId: f.card, amount: 300, description: "iFood", categoryId: f.categories.Software, date: "2026-10-03" }, prisma);
  await prisma.budget.create({
    data: { userId: USER, categoryId: f.categories.Groceries, amount: 500, currency: "BRL", period: "monthly", year: 2026, month: 10, effectiveFrom: new Date(Date.UTC(2026, 9, 1, 12)) },
  });
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

const run = (now = TUESDAY_1PM) => runNotifications(prisma, now, { userIds: [USER] });

describe("runNotifications", () => {
  it("sends the closed card bill and the budget alert once, in pt-BR", async () => {
    const first = await run();
    expect(first.errors).toEqual([]);
    expect(first.claimed).toEqual({ bill_closed: 1, budget_threshold: 1, weekly_summary: 0, asset_stale: 0 });
    const bill = pushes.find((p) => p.payload.tag.startsWith("bill-"))!.payload;
    expect(bill.title).toBe("Fatura do Nubank fechou");
    expect(bill.body).toBe("R$ 300,00 · vence 12/10");
    expect(bill.url).toMatch(/^\/transactions\?draft=/);
    const budget = pushes.find((p) => p.payload.tag.startsWith("budget-"))!.payload;
    expect(budget.title).toBe("Orçamento de Groceries passou de 90%");
    expect(budget.body).toBe("R$ 460,00 de R$ 500,00 em out/2026");
    expect(budget.url).toBe("/transactions/budgets");

    pushes.length = 0;
    const again = await run(new Date("2026-10-06T18:00:00Z"));
    expect(again.claimed).toEqual({ bill_closed: 0, budget_threshold: 0, weekly_summary: 0, asset_stale: 0 });
    expect(again.alreadySent).toBe(2);
    expect(pushes).toHaveLength(0);
    const dispatches = await prisma.notificationDispatch.findMany({ where: { userId: USER }, orderBy: { kind: "asc" } });
    expect(dispatches.map((d) => [d.kind, d.sentCount])).toEqual([["bill_closed", 1], ["budget_threshold", 1]]);
  });

  it("compares a budget in another currency in the base currency", async () => {
    // 1 BRL = 0,2 USD: the USD 100 budget is R$ 500, so R$ 460 spent is 92% of it.
    await prisma.currency.upsert({
      where: { userId_code: { userId: USER, code: "USD" } },
      create: { userId: USER, code: "USD", name: "US Dollar", symbol: "$", manualRate: 0.2 },
      update: { manualRate: 0.2 },
    });
    await updateNotificationSettings(USER, { billClosedEnabled: false }, prisma);
    await prisma.budget.updateMany({ where: { userId: USER }, data: { currency: "USD", amount: 120 } });
    // USD 120 = R$ 600: R$ 460 is 77%, below 90% (compared raw, 460 ≥ 108 would alert).
    expect((await run()).claimed.budget_threshold).toBe(0);

    await prisma.budget.updateMany({ where: { userId: USER }, data: { amount: 100 } });
    expect((await run()).claimed.budget_threshold).toBe(1);
    const budget = pushes.find((p) => p.payload.tag.startsWith("budget-"))!.payload;
    expect(budget.body).toMatch(/92,00 de .*100,00 em out\/2026/);
    expect(budget.body).toContain("US$");
  });

  it("waits for the daytime window and respects the toggles", async () => {
    expect((await run(new Date("2026-10-06T05:00:00Z"))).claimed).toEqual({ bill_closed: 0, budget_threshold: 0, weekly_summary: 0, asset_stale: 0 });
    await updateNotificationSettings(USER, { billClosedEnabled: false, budgetEnabled: false }, prisma);
    expect((await run()).claimed).toEqual({ bill_closed: 0, budget_threshold: 0, weekly_summary: 0, asset_stale: 0 });
    expect(pushes).toHaveLength(0);
  });

  it("stays quiet below the threshold and for bills closed long ago", async () => {
    await updateNotificationSettings(USER, { budgetThreshold: 0.95 }, prisma);
    const later = await run(new Date("2026-10-10T16:00:00Z"));
    expect(later.claimed).toEqual({ bill_closed: 0, budget_threshold: 0, weekly_summary: 0, asset_stale: 0 });
  });

  it("sends the weekly summary of the previous seven days on the chosen day and hour, once per week", async () => {
    await updateNotificationSettings(USER, { weeklyEnabled: true, weeklyDow: 2, weeklyHour: 8, billClosedEnabled: false, budgetEnabled: false }, prisma);
    expect((await run(new Date("2026-10-06T10:30:00Z"))).claimed.weekly_summary).toBe(0); // 07:30 local
    const sent = await run();
    expect(sent.claimed.weekly_summary).toBe(1);
    expect(pushes[0].payload).toMatchObject({ title: "Resumo semanal", body: "29/09 a 05/10: R$ 760,00 em saídas · R$ 1.000,00 em entradas" });
    expect((await run(new Date("2026-10-06T22:00:00Z"))).alreadySent).toBe(1);
  });

  it("writes in English for an English user", async () => {
    await prisma.user.update({ where: { id: USER }, data: { locale: "en", numberFormat: "en-US", dateFormat: "MM/dd/yyyy" } });
    await run();
    const bill = pushes.find((p) => p.payload.tag.startsWith("bill-"))!.payload;
    expect(bill).toMatchObject({ title: "Nubank statement closed", body: "R$ 300.00 · due 10/12" });
  });
});

describe("sendAssetStale", () => {
  afterAll(async () => {
    await prisma.asset.deleteMany({ where: { symbol: { startsWith: "ZZSENDERS" } } });
  });

  async function linkedHolding(symbol: string, lastPriceUpdate: Date | null) {
    const holding = await createHolding(USER, { accountId: f.broker, assetClass: "stocks", ticker: symbol, name: symbol, currency: "BRL" }, prisma);
    const asset = await prisma.asset.create({ data: { symbol, assetClass: "stocks", market: "B3", currency: "BRL" } });
    await prisma.investmentHolding.update({ where: { id: holding.id }, data: { assetId: asset.id, priceSource: "auto", currentPrice: lastPriceUpdate ? 10 : null, lastPriceUpdate } });
    return holding;
  }

  it("pushes once per stale or never-priced linked holding, never for a manual one", async () => {
    await updateNotificationSettings(USER, { billClosedEnabled: false, budgetEnabled: false }, prisma);
    // Thursday's close at Tuesday 13:00 (São Paulo): Friday's and Monday's are both missing.
    const stale = await linkedHolding("ZZSENDERSSTALE", new Date("2026-10-01T20:10:00Z"));
    const never = await linkedHolding("ZZSENDERSNEVER", null);
    // Monday's close on Tuesday afternoon is the newest one there is: no push, all day.
    await linkedHolding("ZZSENDERSFRESH", new Date("2026-10-05T20:10:00Z"));
    const manual = await createHolding(USER, { accountId: f.broker, assetClass: "fixed_income", ticker: "ZZSENDERSCDB", name: "CDB", currency: "BRL" }, prisma);

    const result = await run();
    expect(result.claimed.asset_stale).toBe(2);
    const staleTags = pushes.map((p) => p.payload.tag);
    expect(staleTags).toContain(`asset-stale-${stale.id}`);
    expect(staleTags).toContain(`asset-stale-${never.id}`);
    expect(staleTags).not.toContain(`asset-stale-${manual.id}`);
    const nevered = pushes.find((p) => p.payload.tag === `asset-stale-${never.id}`)!.payload;
    expect(nevered).toMatchObject({ title: "ZZSENDERSNEVER sem cotação atualizada", body: "Nunca foi cotado automaticamente — veja Ajustes › Dados › Saúde dos dados" });
    const staled = pushes.find((p) => p.payload.tag === `asset-stale-${stale.id}`)!.payload;
    expect(staled.title).toBe("ZZSENDERSSTALE sem cotação atualizada");

    pushes.length = 0;
    expect((await run()).claimed.asset_stale).toBe(0); // same episode (lastPriceUpdate unchanged): claimed once already
  });

  it("stays quiet when assetStaleEnabled is off", async () => {
    await updateNotificationSettings(USER, { assetStaleEnabled: false }, prisma);
    await linkedHolding("ZZSENDERSOFF", new Date("2026-10-01T20:10:00Z"));
    expect((await run()).claimed.asset_stale).toBe(0);
  });
});

describe("sendDueReminders and the Notificações toggles", () => {
  const rule = (data: { nextDueDate: string; reminders?: object }) =>
    prisma.recurringRule.create({
      data: {
        userId: USER,
        entityId: f.pfId,
        accountId: f.pfChecking,
        kind: "expense",
        amount: 2500,
        currency: "BRL",
        description: "Aluguel",
        categoryId: f.categories.Groceries,
        frequency: "monthly",
        startDate: new Date("2026-01-07T12:00:00Z"),
        nextDueDate: new Date(`${data.nextDueDate}T12:00:00Z`),
        autoGenerate: false,
        ...(data.reminders && { reminders: data.reminders }),
      },
    });
  // Tuesday 2026-10-06 09:05 in São Paulo.
  const NINE_AM = new Date("2026-10-06T12:05:00Z");

  it("reminds a bill without its own reminders one day before at 09:00 by default", async () => {
    await rule({ nextDueDate: "2026-10-07" });
    const result = await sendDueReminders(prisma, NINE_AM, { userIds: [USER] });
    expect(result.instancesClaimed).toBe(1);
    expect(pushes[0].payload).toMatchObject({ title: "Lembrete: Aluguel", body: "Vence amanhã — ~R$ 2.500,00 (Groceries)", url: "/transactions/budgets" });
  });

  it("mutes due reminders when the Contas fixas toggle is off", async () => {
    await rule({ nextDueDate: "2026-10-07" });
    await updateNotificationSettings(USER, { dueEnabled: false }, prisma);
    const result = await sendDueReminders(prisma, NINE_AM, { userIds: [USER] });
    expect(result.instancesClaimed).toBe(0);
    expect(pushes).toHaveLength(0);
  });

  it("caps the default overdue nag at a week but keeps a rule's own overdue reminders", async () => {
    await rule({ nextDueDate: "2026-09-01" });
    expect((await sendDueReminders(prisma, NINE_AM, { userIds: [USER] })).instancesClaimed).toBe(0);
    await rule({ nextDueDate: "2026-10-03", reminders: { entries: [], overdue: { enabled: true, time: "09:00" } } });
    const result = await sendDueReminders(prisma, NINE_AM, { userIds: [USER] });
    expect(result.instancesClaimed).toBe(1);
    expect(pushes[0].payload.body).toBe("Venceu há 3 dias — ~R$ 2.500,00 (Groceries). Marque como pago ou concluído.");
    await updateNotificationSettings(USER, { overdueEnabled: false }, prisma);
    await rule({ nextDueDate: "2026-10-04", reminders: { entries: [], overdue: { enabled: true, time: "09:00" } } });
    expect((await sendDueReminders(prisma, NINE_AM, { userIds: [USER] })).instancesClaimed).toBe(0);
  });
});
