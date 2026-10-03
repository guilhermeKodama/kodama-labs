import Link from "next/link";
import { cn } from "@/lib/utils";

export type ScorecardTone = "default" | "muted" | "warn" | "alert";

export interface ScorecardItem {
  label: string;
  value: React.ReactNode;
  hint?: string;
  href?: string;
  tone?: ScorecardTone;
}

const toneClasses: Record<ScorecardTone, string> = {
  default: "",
  muted: "text-muted-foreground",
  warn: "text-orange-500",
  alert: "text-red-500",
};

/**
 * Compact at-a-glance metric strip shown under the politician header, visible
 * across all tabs. Presentational + graceful: the caller passes only the
 * metrics that currently have data, so it lights up as later milestones land.
 */
export function PoliticianScorecard({ items }: { items: ScorecardItem[] }) {
  if (items.length === 0) return null;

  return (
    <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
      {items.map((item, i) => {
        const inner = (
          <>
            <p className="text-[11px] text-muted-foreground">{item.label}</p>
            <p
              className={cn(
                "mt-0.5 text-base font-bold tabular-nums",
                toneClasses[item.tone ?? "default"],
              )}
            >
              {item.value}
            </p>
            {item.hint && (
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                {item.hint}
              </p>
            )}
          </>
        );
        const className = cn(
          "rounded-lg border bg-card p-3 block",
          item.href && "hover:bg-muted/40 transition-colors",
        );
        return item.href ? (
          <Link key={i} href={item.href} className={className}>
            {inner}
          </Link>
        ) : (
          <div key={i} className={className}>
            {inner}
          </div>
        );
      })}
    </div>
  );
}
