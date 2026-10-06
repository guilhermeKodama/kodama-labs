"use client";

import { useTranslations } from "next-intl";
import type { LedgerSummary } from "@capital/server/modules/ledger/contracts";
import { Kpi, KpiStrip } from "@/components/cap";
import { useFmt } from "@/lib/format/provider";

/**
 * Entradas / Saídas / Aportes / Resultado / Linhas over the counted
 * display rows of the view (mockup 3107–3115, totals() 541–552); only in
 * the table layout. A neutral transfer moves nothing; an aporte is not a
 * Saída.
 */
export function KpiSummary({ summary }: { summary: LedgerSummary | null | undefined }) {
  const t = useTranslations("ledger.kpi");
  const fmt = useFmt();
  const s = summary ?? { income: 0, expense: 0, investment: 0, net: 0, count: 0 };
  return (
    <KpiStrip>
      <Kpi label={t("income")} value={fmt.money(s.income)} tone="pos" />
      <Kpi label={t("expense")} value={fmt.money(-s.expense)} />
      <Kpi label={t("investment")} value={fmt.money(-s.investment)} />
      <Kpi label={t("net")} value={fmt.money(s.net)} tone={s.net >= 0 ? "pos" : "neg"} />
      <Kpi label={t("rows")} value={fmt.number(s.count, 0)} />
    </KpiStrip>
  );
}
