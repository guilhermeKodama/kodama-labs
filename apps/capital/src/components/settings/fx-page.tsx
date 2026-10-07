"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Check, Select, Table, TextInput } from "@/components/cap";
import type { FxSource } from "@capital/server/modules/currencies/lib/fx-source";
import { apiGet, apiPatch, apiPost } from "@/lib/api/client";
import { keys } from "@/lib/api/keys";
import { useSession, type SessionUser } from "@/lib/api/session";
import { useAppMutation } from "@/lib/api/use-app-mutation";
import { useFmt } from "@/lib/format/provider";
import { basePerUnit, manualRateFromBase, rateDigits } from "@/lib/settings/fx";
import { useBaseCurrencyChange } from "./base-currency";

/** GET /v2/currencies. */
interface CurrencyRow {
  code: string;
  name: string;
  symbol: string;
  manualRate: number;
  basePerUnit: number | null;
  source: FxSource;
  rateUpdatedAt: string | null;
  updatedAt: string;
}
interface CurrencyList {
  baseCurrency: string;
  fxAutoUpdate: boolean;
  currencies: CurrencyRow[];
}

/**
 * Moedas e câmbio: the base currency, the automatic FX switch (PTAX on a
 * BRL base, ECB otherwise) and the rates in the base currency. Typing a
 * rate makes it manual, which the automatic update leaves alone.
 */
export function FxPage() {
  const t = useTranslations("settings.fx");
  const fmt = useFmt();
  const me = useSession().data;
  const list = useQuery({ queryKey: keys.currencies(), queryFn: () => apiGet<CurrencyList>("/api/v2/currencies") });
  const base = useBaseCurrencyChange();
  const [editing, setEditing] = useState<{ code: string; text: string } | null>(null);

  const toggleAuto = useAppMutation({
    event: "settings.write",
    mutationFn: async (fxAutoUpdate: boolean) => {
      const user = await apiPatch<SessionUser>("/api/v2/me", { fxAutoUpdate });
      // Turning it on fetches today's rates right away instead of waiting for the cron.
      if (fxAutoUpdate) await apiPost("/api/v2/currencies/refresh", {});
      return user;
    },
  });
  const saveRate = useAppMutation({
    event: "settings.write",
    mutationFn: ({ code, manualRate }: { code: string; manualRate: number }) => apiPatch<CurrencyRow>(`/api/v2/currencies/${code}`, { manualRate }),
    onSuccess: () => setEditing(null),
  });

  const data = list.data;
  const baseCode = data?.baseCurrency ?? me?.baseCurrency ?? "BRL";
  const auto = data?.fxAutoUpdate ?? me?.fxAutoUpdate ?? false;
  const rows = (data?.currencies ?? []).filter((c) => c.code !== baseCode);
  const codes = (data?.currencies ?? []).map((c) => c.code);

  const commit = (row: CurrencyRow) => {
    // Enter commits, and the blur that follows must not save it a second time.
    if (!editing || editing.code !== row.code || saveRate.isPending) return;
    const manualRate = manualRateFromBase(fmt.parseNumber(editing.text));
    if (manualRate === null || Math.abs(manualRate - row.manualRate) < 1e-12) {
      setEditing(null);
      return;
    }
    saveRate.mutate({ code: row.code, manualRate });
  };
  const rateText = (row: CurrencyRow) => {
    const value = row.basePerUnit ?? basePerUnit(row.manualRate);
    return value === null ? "—" : fmt.number(value, rateDigits(value));
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="text-body-sm text-fg-3">{t("base")}</span>
        <Select
          aria-label={t("base")}
          className="w-[90px]"
          value={baseCode}
          onChange={base.change}
          disabled={base.saving}
          options={(codes.includes(baseCode) ? codes : [baseCode, ...codes]).map((code) => ({ value: code, label: code }))}
        />
        <span className="flex-1" />
        <Check checked={auto} disabled={toggleAuto.isPending || !data} onChange={(value) => toggleAuto.mutate(value)} label={t("auto", { base: baseCode })} />
      </div>
      <Table
        headers={[t("headers.currency"), t("headers.symbol"), t("headers.rate", { base: baseCode }), t("headers.source"), t("headers.updated")]}
        columnAlign={["left", "left", "right", "left", "left"]}
        rowKey={(i) => rows[i].code}
        emptyMessage={list.isSuccess ? t("empty") : undefined}
        rows={rows.map((row) => [
          t("currencyName", { name: row.name, code: row.code }),
          row.symbol,
          editing?.code === row.code ? (
            <TextInput
              key="rate"
              autoFocus
              aria-label={t("editRate", { code: row.code, base: baseCode })}
              value={editing.text}
              onChange={(text) => setEditing({ code: row.code, text })}
              onBlur={() => commit(row)}
              onKeyDown={(event) => {
                if (event.key === "Enter") commit(row);
                if (event.key === "Escape") {
                  event.stopPropagation();
                  setEditing(null);
                }
              }}
              disabled={saveRate.isPending}
              mono
              className="h-[24px] w-[96px] text-right"
            />
          ) : (
            <button
              key="rate"
              type="button"
              title={t("editRate", { code: row.code, base: baseCode })}
              onClick={() => setEditing({ code: row.code, text: rateText(row) })}
              className="rounded-[4px] px-1 font-mono tabular-nums outline-none hover:bg-fill-3 focus-visible:ring-2 focus-visible:ring-fg-3/40"
            >
              {rateText(row)}
            </button>
          ),
          t(`source.${row.source}`),
          <span key="updated" className="text-fg-2">
            {/* When the rate in force was quoted or typed; a seeded placeholder rate has no date yet. */}
            {row.rateUpdatedAt ? fmt.relative(row.rateUpdatedAt) : "—"}
          </span>,
        ])}
      />
      <span className="text-body-sm text-fg-3">{t("footnote")}</span>
      {base.dialog}
    </div>
  );
}
