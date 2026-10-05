"use client";

import { useTranslations } from "next-intl";
import type { ExecuteImportResult } from "@capital/server/modules/bank-statements/services/execute-import";
import { Btn, Callout, Kpi, KpiStrip } from "@/components/cap";
import type { AccountRecord } from "@/lib/api/catalog";
import { useFmt } from "@/lib/format/provider";
import { isCardKind, statementMonthParts, type ImportAnalysis, type ReviewSummary } from "@/lib/import/review";

/**
 * Confirmar (mockup 5755-5768): what the commit will do, as KPIs, and for
 * a card bill the statement it ends up with and its payment.
 */
export function ConfirmStep({
  analysis,
  summary,
  currency,
  linkBill,
  accounts,
  account,
}: {
  analysis: ImportAnalysis;
  summary: ReviewSummary;
  currency: string;
  linkBill: boolean;
  accounts: readonly AccountRecord[];
  /** The account imported into. */
  account: AccountRecord | null;
}) {
  const t = useTranslations("import.confirm");
  const tImport = useTranslations("import");
  const fmt = useFmt();
  const card = isCardKind(analysis.kind) ? analysis.card : null;

  const ignoredSub =
    summary.ignored > 0 && summary.ignoredDuplicates === summary.ignored
      ? t("ignoredDuplicates")
      : summary.ignoredDuplicates > 0
        ? t("ignoredSomeDuplicates", { count: summary.ignoredDuplicates })
        : undefined;

  let sentence: string | null = null;
  if (card) {
    const parts = statementMonthParts(card.month);
    const month = tImport("monthShort", { abbr: fmt.monthAbbr(parts.month), yy: parts.yy });
    const bill = t("card", { month, bank: analysis.bank ?? account?.name ?? "", count: card.existingCount + summary.included, total: fmt.money(card.total, currency) });
    const payFrom = card.payFromAccountId ? accounts.find((a) => a.id === card.payFromAccountId)?.name : null;
    const due = card.dueDate ? fmt.date(card.dueDate) : null;
    const payment = linkBill && due ? (payFrom ? t("cardPayment", { due, account: payFrom }) : t("cardPaymentNoAccount", { due })) : null;
    sentence = payment ? `${bill} ${payment}` : bill;
  } else if (summary.transfers > 0) {
    sentence = t("transfers", { count: summary.transfers });
  }

  return (
    <>
      <KpiStrip>
        <Kpi label={t("included")} value={fmt.number(summary.included, 0)} />
        <Kpi label={t("ignored")} value={fmt.number(summary.ignored, 0)} sub={ignoredSub} />
        <Kpi label={t("total")} value={fmt.money(summary.total, currency)} />
        <Kpi label={t("rules")} value={fmt.number(summary.rules, 0)} />
      </KpiStrip>
      {sentence ? <p className="text-[12px] text-fg-2">{sentence}</p> : null}
    </>
  );
}

/** After the commit (mockup 5780-5791): what was imported where, its view, and undoing it. */
export function DoneState({
  result,
  reverting,
  onOpenView,
  onUndo,
}: {
  result: ExecuteImportResult;
  reverting: boolean;
  onOpenView: () => void;
  onUndo: () => void;
}) {
  const t = useTranslations("import.done");
  return (
    <>
      <Callout tone="success" title={t("title", { count: result.rowsImported + result.reconciled, account: result.accountName })}>
        {result.viewName ? t("body", { view: result.viewName }) : t("bodyNoView")}
      </Callout>
      <div className="flex items-center gap-1.5">
        {result.viewId ? (
          <Btn primary onClick={onOpenView}>
            {t("openView")}
          </Btn>
        ) : null}
        <Btn ghost disabled={reverting} onClick={onUndo}>
          {t("undo")}
        </Btn>
      </div>
    </>
  );
}
