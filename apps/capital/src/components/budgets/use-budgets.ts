"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api/client";
import { keys } from "@/lib/api/keys";
import { monthKey, type YearMonth } from "@/lib/budgets/period";
import type { BudgetsScope } from "@/lib/budgets/url";
import type { MonthOverview, YearOverview } from "@capital/server/modules/budgets/services/budget-overview";
import type { serializeRule } from "@capital/server/modules/recurring/services/recurring-rules";

export type { MonthOverview, YearOverview };
export type BudgetRow = MonthOverview["budgets"][number];
export type YearlyBudgetRow = MonthOverview["yearlyBudgets"][number];
export type UpcomingItem = MonthOverview["upcoming"][number];
export type HeatmapRow = YearOverview["categories"][number];
export type YearInsightRow = YearOverview["insights"][number];
export type RecurringRule = ReturnType<typeof serializeRule>;

const scopeParam = (scope: BudgetsScope) => (scope === "all" ? undefined : scope);

/** GET /v2/budgets/overview?month= — the Mensal view. Keeps the previous month on screen while the next one loads. */
export function useMonthOverview(month: YearMonth, scope: BudgetsScope, enabled = true) {
  const params = { month: monthKey(month), scope: scopeParam(scope) };
  return useQuery({
    queryKey: keys.budgets({ mode: "month", ...params }),
    queryFn: () => apiGet<MonthOverview>("/api/v2/budgets/overview", params),
    placeholderData: keepPreviousData,
    enabled,
  });
}

/** GET /v2/budgets/overview?year= — the Anual view (budgeted rows only). */
export function useYearOverview(year: number, scope: BudgetsScope, enabled = true) {
  const params = { year: String(year), scope: scopeParam(scope) };
  return useQuery({
    queryKey: keys.budgets({ mode: "year", ...params }),
    queryFn: () => apiGet<YearOverview>("/api/v2/budgets/overview", params),
    placeholderData: keepPreviousData,
    enabled,
  });
}

/** Every recurring rule (paused ones included) in a scope: Contas fixas' editor and "Ver todas". */
export function useRecurringRules(scope: BudgetsScope, enabled = true) {
  const params = { includeInactive: true, scope: scopeParam(scope) };
  return useQuery({
    queryKey: keys.recurring(params),
    queryFn: async () => (await apiGet<{ rules: RecurringRule[] }>("/api/v2/recurring", params)).rules,
    enabled,
  });
}
