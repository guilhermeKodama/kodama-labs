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
  // Before the first answer the strip reads "—" rather than zeros.
  const s = summary ?? null;
  const money = (value: number | undefined) => (s && value !== undefined ? fmt.money(value) : "—");
  return (
    <KpiStrip>
      <Kpi label={t("income")} value={money(s?.income)} tone={s ? "pos" : undefined} />
      <Kpi label={t("expense")} value={money(s ? -s.expense : undefined)} />
      <Kpi label={t("investment")} value={money(s ? -s.investment : undefined)} />
      <Kpi label={t("net")} value={money(s?.net)} tone={s ? (s.net >= 0 ? "pos" : "neg") : undefined} />
      <Kpi label={t("rows")} value={s ? fmt.number(s.count, 0) : "—"} />
    </KpiStrip>
  );
}
