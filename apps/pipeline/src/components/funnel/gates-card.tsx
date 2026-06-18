"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { Check, X, HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBRL, formatPct } from "@/lib/format";
import {
  isManualGate,
  type GateItem,
  type GateResult,
  type Gates,
} from "@/lib/funnel/gates";

export interface EvaluatedGates {
  go: Array<{ item: GateItem; result: GateResult | null; current: number | null }>;
  pivot: Array<{ item: GateItem; result: GateResult | null; current: number | null }>;
  kill: Array<{ item: GateItem; result: GateResult | null; current: number | null }>;
}

function gateLabel(item: GateItem, t: (key: string) => string): string {
  if (isManualGate(item)) return item.label;
  const metricName = t(`gateMetrics.${item.metric}`);
  const op = { lt: "<", lte: "≤", gt: ">", gte: "≥" }[item.op];
  const value =
    item.unit === "cents" ? formatBRL(item.value) : formatPct(item.value);
  return `${metricName} ${op} ${value}${item.label ? ` (${item.label})` : ""}`;
}

function ResultIcon({ result }: { result: GateResult | null }) {
  if (result === "pass") return <Check className="h-3.5 w-3.5 text-success" />;
  if (result === "fail") return <X className="h-3.5 w-3.5 text-destructive" />;
  return <HelpCircle className="h-3.5 w-3.5 text-muted-foreground/50" />;
}

export function GatesCard({
  slug,
  gates,
}: {
  slug: string;
  gates: EvaluatedGates;
}) {
  const t = useTranslations("idea");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  async function toggle(section: keyof Gates, label: string, checked: boolean) {
    await fetch(`/api/v1/ideas/${slug}/gates`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ section, label, checked }),
    });
    startTransition(() => router.refresh());
  }

  const sections: Array<{ key: keyof Gates; tone: string }> = [
    { key: "go", tone: "text-success" },
    { key: "pivot", tone: "text-warning" },
    { key: "kill", tone: "text-destructive" },
  ];

  return (
    <div className="rounded-lg border bg-card p-4">
      <h3 className="text-sm font-semibold mb-3">{t("gates.title")}</h3>
      <div className="grid gap-4 md:grid-cols-3">
        {sections.map(({ key, tone }) => (
          <div key={key}>
            <h4 className={cn("text-xs font-bold uppercase tracking-wide mb-2", tone)}>
              {t(`gates.${key}`)}
            </h4>
            <ul className="space-y-1.5">
              {gates[key].length === 0 ? (
                <li className="text-xs text-muted-foreground">—</li>
              ) : null}
              {gates[key].map(({ item, result, current }, i) => (
                <li key={i} className="flex items-start gap-2 text-xs leading-snug">
                  {isManualGate(item) ? (
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={item.checkedAt != null}
                      disabled={pending}
                      onChange={(e) => toggle(key, item.label, e.target.checked)}
                    />
                  ) : (
                    <span className="mt-0.5">
                      <ResultIcon result={result} />
                    </span>
                  )}
                  <span>
                    {gateLabel(item, t)}
                    {!isManualGate(item) && current != null ? (
                      <span className="text-muted-foreground">
                        {" · "}
                        {t("gates.current")}{" "}
                        {item.unit === "cents"
                          ? formatBRL(Math.round(current))
                          : formatPct(current)}
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
