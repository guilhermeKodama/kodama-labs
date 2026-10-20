"use client";

import { useMemo } from "react";
import { useFireSummary, usePortfolioHistory } from "@/lib/invest/api";
import { arrivalRange, fireRingsView, type FireRingsView } from "@/lib/invest/fire-rings";

/** Years of history the trunk reads (the history endpoint's limit). */
const HISTORY_MONTHS = 120;

/**
 * The FIRE summary and the Carteira's history, as the trunk's view model.
 * The history covers what the FIRE base covers: PF, plus PJ when the plan
 * includes the business investments.
 */
export function useFireRings() {
  const summary = useFireSummary(null);
  const scope = summary.data?.goal?.includeBusinessInvestments ? "all" : "pf";
  const history = usePortfolioHistory(scope, HISTORY_MONTHS);
  const view = useMemo(
    () => (summary.data && history.data ? fireRingsView(summary.data, history.data.months, new Date()) : null),
    [summary.data, history.data],
  );
  return { summary: summary.data ?? null, view, isLoading: summary.isLoading || history.isLoading };
}

/** The 80% arrival range (Monte Carlo), once per plan; null without the user's age. */
export function useArrivalRange(plan: FireRingsView["plan"]) {
  return useMemo(
    () =>
      plan && !plan.reached
        ? arrivalRange(plan.assumptions, plan.fireNumber, { currentAge: plan.currentAge, lifeExpectancyAge: plan.lifeExpectancyAge, annualVolatility: plan.annualVolatility }, new Date())
        : null,
    [plan],
  );
}
