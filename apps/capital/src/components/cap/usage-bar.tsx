import { cn } from "@/lib/utils";

export type UsageTone = "default" | "strong" | "warn" | "neg" | "pos";

const FILL: Record<UsageTone, string> = {
  default: "bg-fg-2",
  strong: "bg-fg-1",
  warn: "bg-warn-solid",
  neg: "bg-neg-solid",
  pos: "bg-pos",
};

/**
 * Horizontal progress bar (budget spent, allocation vs target, FIRE
 * progress). `value` and `marker` are fractions of the track; the fill is
 * clamped to it, the marker (pace, target) is a thin vertical line.
 */
export function UsageBar({
  value,
  marker,
  tone = "default",
  size = "sm",
  className,
  "aria-label": ariaLabel,
}: {
  value: number;
  marker?: number | null;
  tone?: UsageTone;
  /** sm: 6px track (budgets); md: 8px with a 2px marker (allocation). */
  size?: "sm" | "md";
  className?: string;
  "aria-label"?: string;
}) {
  const clamp = (n: number) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));
  return (
    <span
      role="meter"
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamp(value) * 100)}
      className={cn("relative block rounded-full bg-fill-2", size === "sm" ? "h-1.5" : "h-2", className)}
    >
      <span className={cn("absolute inset-y-0 left-0 rounded-full", FILL[tone])} style={{ width: `${clamp(value) * 100}%` }} />
      {marker != null ? (
        <span
          className={cn("absolute -top-[3px] bg-fg-1", size === "sm" ? "h-3 w-px" : "h-3.5 w-0.5")}
          style={{ left: `${clamp(marker) * 100}%` }}
        />
      ) : null}
    </span>
  );
}
