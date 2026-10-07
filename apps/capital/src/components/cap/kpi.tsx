import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type KpiTone = "pos" | "neg" | "warn";

/** Label (11px tertiary), value (mono 17px/500, toned) and an optional sub line. */
export function Kpi({ label, value, sub, tone }: { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: KpiTone }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-caption text-fg-3">{label}</span>
      <span className={cn("font-mono text-kpi font-medium tabular-nums", tone === "pos" && "text-pos", tone === "neg" && "text-neg", tone === "warn" && "text-warn")}>
        {value}
      </span>
      {sub ? <span className="text-caption text-fg-3">{sub}</span> : null}
    </div>
  );
}

/** Row of Kpis in a bordered strip: 28px gap, 12px × 14px padding. */
export function KpiStrip({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-wrap gap-7 rounded-[8px] border border-stroke-3 px-3.5 py-3", className)}>{children}</div>;
}
