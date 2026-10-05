"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { money } from "@/lib/money";
import { useSession } from "@/lib/session";

interface Allocation {
  assetClass: string;
  marketValue: number;
  share: number;
  target: number | null;
}

interface Summary {
  baseCurrency: string;
  marketValue: number;
  invested: number;
  unrealizedGain: number;
  cash: number;
  netWorth: number;
  allocation: Allocation[];
}

interface Holding {
  id: string;
  name: string;
  ticker: string | null;
  assetClass: string;
  currentQuantity: number;
  marketValue: number;
  currency: string;
}

export function PortfolioScreen() {
  const t = useTranslations("app");
  const session = useSession();
  const [entityId, setEntityId] = useState("");
  const summary = useQuery({
    queryKey: ["portfolio", entityId],
    queryFn: () => api<Summary>(`/api/v2/portfolio/summary${entityId ? `?entityId=${entityId}` : ""}`),
  });
  const holdings = useQuery({
    queryKey: ["holdings", entityId],
    queryFn: async () => (await api<{ holdings: Holding[] }>(`/api/v2/holdings${entityId ? `?entityId=${entityId}` : ""}`)).holdings,
  });
  const currency = summary.data?.baseCurrency ?? session.data?.baseCurrency ?? "BRL";
  const grouped = new Map<string, Holding[]>();
  for (const holding of holdings.data ?? []) {
    const list = grouped.get(holding.assetClass) ?? [];
    list.push(holding);
    grouped.set(holding.assetClass, list);
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">{t("portfolio")}</h1>
        <select className="h-9 rounded-md border bg-transparent px-2 text-sm" value={entityId} onChange={(event) => setEntityId(event.target.value)}>
          <option value="">{t("allEntities")}</option>
          {(session.data?.entities ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </div>
      {summary.data ? (
        <div className="grid gap-3 sm:grid-cols-4">
          <Stat label={t("netWorth")} value={money(summary.data.netWorth, currency)} />
          <Stat label={t("invested")} value={money(summary.data.marketValue, currency)} />
          <Stat label={t("cash")} value={money(summary.data.cash, currency)} />
          <Stat label={t("gain")} value={money(summary.data.unrealizedGain, currency)} />
        </div>
      ) : null}
      <section className="space-y-2">
        {(summary.data?.allocation ?? []).map((item) => (
          <div key={item.assetClass} className="grid grid-cols-[8rem_1fr_auto] items-center gap-3 text-sm">
            <span>{item.assetClass}</span>
            <span className="relative h-2 rounded-full bg-muted">
              <span className="absolute inset-y-0 left-0 rounded-full bg-foreground/80" style={{ width: `${Math.min(item.share * 100, 100)}%` }} />
              {item.target != null ? <span className="absolute top-[-3px] h-3.5 w-px bg-red-500" style={{ left: `${Math.min(item.target * 100, 100)}%` }} /> : null}
            </span>
            <span className="font-mono tabular-nums">{(item.share * 100).toFixed(1)}%{item.target != null ? ` / ${(item.target * 100).toFixed(0)}%` : ""}</span>
          </div>
        ))}
      </section>
      {[...grouped.entries()].map(([assetClass, list]) => (
        <section key={assetClass}>
          <h2 className="mb-2 text-sm font-medium">{assetClass}</h2>
          <table className="w-full text-sm">
            <tbody>
              {list.map((holding) => (
                <tr key={holding.id} className="border-t">
                  <td className="py-2">{holding.ticker ? `${holding.ticker} · ` : ""}{holding.name}</td>
                  <td className="py-2 text-right font-mono tabular-nums">{holding.currentQuantity}</td>
                  <td className="py-2 text-right font-mono tabular-nums">{money(holding.marketValue, holding.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-mono text-lg tabular-nums">{value}</p>
    </div>
  );
}
