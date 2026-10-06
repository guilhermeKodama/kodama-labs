import { describe, expect, it } from "vitest";
import { GET as serviceWorker } from "@/app/sw.js/route";
import { REMINDER_PUSH_URL } from "@capital/server/modules/push/constants";
import { buildPayload } from "../send-due-reminders";

/** /recurring is gone: reminders open Orçamentos (Contas fixas), from the push and from the service worker's fallback. */
const row = { id: "rule-1", description: "Aluguel", category: "Casa", amount: 2500, currency: "BRL", nextDueDate: new Date("2026-10-10T12:00:00Z") };

describe("reminder push deep link", () => {
  it("points every reminder at /transactions/budgets", () => {
    expect(REMINDER_PUSH_URL).toBe("/transactions/budgets");
    const scheduledAt = new Date("2026-10-09T12:00:00Z");
    expect(buildPayload(row, { daysBefore: 1, scheduledAt, kind: "pre-due" }).url).toBe("/transactions/budgets");
    expect(buildPayload(row, { daysBefore: 0, scheduledAt, kind: "due-today" }).url).toBe("/transactions/budgets");
    expect(buildPayload(row, { daysBefore: -2, scheduledAt, kind: "overdue" }).url).toBe("/transactions/budgets");
  });

  it("is the service worker's fallback too", async () => {
    const script = await serviceWorker().text();
    expect(script).not.toContain("/recurring");
    expect(script.match(/"\/transactions\/budgets"/g)).toHaveLength(3);
  });
});
