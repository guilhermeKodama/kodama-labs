"use client";

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { parseAsString, useQueryStates } from "nuqs";
import { Btn, Segmented } from "@/components/cap";
import { Page } from "@/components/shell/page";
import { todayIn } from "@/lib/budgets/period";
import { budgetsParams, openMonth, resolveBudgetsView, stepView, switchMode, type BudgetsMode, type BudgetsView } from "@/lib/budgets/url";
import { useFmt } from "@/lib/format/provider";
import { BudgetDialogs, type BudgetDialogState, type EditableBudget } from "./budget-dialog";
import { MonthView } from "./month-view";
import { PeriodNav, type BudgetActions } from "./parts";
import { RuleDialog, RulesSheet } from "./rule-dialog";
import { YearView } from "./year-view";

const URL_PARAMS = { mode: parseAsString, m: parseAsString, y: parseAsString, scope: parseAsString };

/**
 * Transações › Orçamentos (mockup BudgetsScreen / AnnualBudget). Mensal:
 * budgets of a month with today's pace and Contas fixas (which replaces
 * the Recorrentes page); Anual: the category × month heatmap, trends and
 * yearly budgets. Mode, month, year and scope live in the URL (mode, m,
 * y, scope); every number opens Transações filtered to its entries.
 */
export function BudgetsScreen() {
  const t = useTranslations("budgets");
  const fmt = useFmt();
  const day = todayIn(fmt.prefs.timezone);
  const today = useMemo(() => ({ year: day.year, month: day.month }), [day.year, day.month]);
  const [params, setParams] = useQueryStates(URL_PARAMS);
  const view = resolveBudgetsView(params, today);
  const go = useCallback((next: BudgetsView) => void setParams(budgetsParams(next, today)), [setParams, today]);

  const [dialog, setDialog] = useState<BudgetDialogState | null>(null);
  const [ruleId, setRuleId] = useState<string | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);

  // The month a create, edit or delete starts from: the month on screen (Mensal), else today's month in the year on screen.
  const actionMonth = view.mode === "month" ? view.month : view.year === today.year ? today : { year: view.year, month: 1 };
  const actions: BudgetActions = {
    onEdit: (budget: EditableBudget) => setDialog({ kind: "edit", budget, month: actionMonth }),
    onDelete: (budget: EditableBudget) => setDialog({ kind: "delete", budget, month: actionMonth }),
  };
  const isYear = view.mode === "year";

  return (
    <Page
      crumbs={[t("crumbs.transactions"), t("crumbs.budgets")]}
      actions={
        <>
          <Segmented<BudgetsMode>
            aria-label={t("mode.label")}
            value={view.mode}
            options={[
              { v: "month", l: t("mode.month") },
              { v: "year", l: t("mode.year") },
            ]}
            onChange={(mode) => go(switchMode(view, mode, today))}
          />
          <PeriodNav
            label={isYear ? String(view.year) : fmt.monthLabel(view.month)}
            onPrev={() => go(stepView(view, -1))}
            onNext={() => go(stepView(view, 1))}
            prevLabel={t(isYear ? "nav.prevYear" : "nav.prevMonth")}
            nextLabel={t(isYear ? "nav.nextYear" : "nav.nextMonth")}
          />
          <Btn primary onClick={() => setDialog({ kind: "create", month: actionMonth, scope: view.scope })}>
            {t("newBudget")}
          </Btn>
        </>
      }
    >
      {isYear ? (
        <YearView view={view} today={today} onScope={(scope) => go({ ...view, scope })} onOpenMonth={(month) => go(openMonth(view, month))} actions={actions} />
      ) : (
        <MonthView view={view} onScope={(scope) => go({ ...view, scope })} actions={actions} onOpenRule={setRuleId} onAllRules={() => setRulesOpen(true)} />
      )}
      <BudgetDialogs state={dialog} onChange={setDialog} />
      <RulesSheet open={rulesOpen} onOpenChange={setRulesOpen} scope={view.scope} onOpenRule={setRuleId} />
      <RuleDialog ruleId={ruleId} scope={view.scope} onClose={() => setRuleId(null)} />
    </Page>
  );
}
